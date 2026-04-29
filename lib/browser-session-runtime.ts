import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { Buffer } from "node:buffer";
import bundledChromium from "@sparticuz/chromium";
import { chromium, type Browser, type Frame, type Locator, type Page } from "playwright-core";
import Anthropic from "@anthropic-ai/sdk";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { analyzeChartWithVision, type ChartVisionDecision } from "./chart-vision-analysis";

type BrowserStepStatus = "queued" | "running" | "completed" | "failed";

export type BrowserStreamPayload = {
  frame: string;
  mimeType: "image/png";
  timestamp: number;
  actionLabel?: string;
  visionDecision?: ChartVisionDecision;
  pointer?: {
    x: number;
    y: number;
    viewportWidth: number;
    viewportHeight: number;
    pulseId: number;
    clickAt?: number;
    dragging?: boolean;
    trail?: Array<{
      x: number;
      y: number;
    }>;
  };
};

type SessionRuntime = {
  browser: Browser;
  page: Page;
  screenshotPath: string;
  captureLoop?: ReturnType<typeof setInterval>;
  latestPayload?: BrowserStreamPayload;
  pointer?: BrowserStreamPayload["pointer"];
  pointerPulseId: number;
  currentActionLabel?: string;
  visionDecision?: ChartVisionDecision;
  listeners: Set<(payload: BrowserStreamPayload) => void>;
};

const runtimeSessions = new Map<string, SessionRuntime>();
const SCREENSHOT_ROOT = "/tmp/gildore-browser-sessions";

function isServerlessRuntime() {
  return Boolean(
    process.env.VERCEL ||
      process.env.AWS_REGION ||
      process.env.AWS_EXECUTION_ENV,
  );
}

async function launchBrowser() {
  if (isServerlessRuntime()) {
    const executablePath = await bundledChromium.executablePath();
    return chromium.launch({
      args: bundledChromium.args,
      executablePath,
      headless: true,
    });
  }

  const playwright = await import("playwright");
  return playwright.chromium.launch({ headless: true });
}

function getConvexClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured.");
  }

  return new ConvexHttpClient(url);
}

async function ensureScreenshotDir() {
  await fs.mkdir(SCREENSHOT_ROOT, { recursive: true });
}

function screenshotPathFor(sessionId: string) {
  return path.join(SCREENSHOT_ROOT, `${sessionId}.png`);
}

function buildSteps(marketSymbol: string, timeframe: string) {
  return [
    {
      status: "loading_chart" as const,
      label: "Open Deriv chart",
      detail: "Load the Deriv chart surface in the controlled Chromium session.",
    },
    {
      status: "switching_symbol" as const,
      label: `Switch symbol to ${marketSymbol}`,
      detail: `Locate the market selector and target ${marketSymbol}.`,
    },
    {
      status: "switching_timeframe" as const,
      label: `Switch timeframe to ${timeframe}`,
      detail: `Locate the interval control and target ${timeframe}.`,
    },
    {
      status: "ready" as const,
      label: "Hold chart for review",
      detail:
        "Keep the controlled chart open and stable for visual review in Arena.",
    },
  ];
}

async function writeStepState(args: {
  sessionId: string;
  steps: ReturnType<typeof buildSteps>;
  currentIndex: number;
  currentStatus:
    | ReturnType<typeof buildSteps>[number]["status"]
    | "failed";
  error?: string;
}) {
  const convex = getConvexClient();
  const { sessionId, steps, currentIndex, currentStatus, error } = args;

  await convex.mutation(api.arena.updateBrowserSessionState, {
    sessionId: sessionId as never,
    status: currentStatus,
    currentStepLabel: steps[currentIndex - 1]?.label ?? "Session update",
    currentStepIndex: currentIndex,
    completedAt: currentStatus === "ready" ? Date.now() : undefined,
    error,
  });

  const events = steps.map((step, index) => {
    let status: BrowserStepStatus = "queued";
    if (index + 1 < currentIndex) status = "completed";
    if (index + 1 === currentIndex) {
      status = currentStatus === "failed" ? "failed" : currentStatus === "ready" ? "completed" : "running";
    }

    return {
      sequence: index + 1,
      label: step.label,
      detail: step.detail,
      status,
    };
  });

  await convex.mutation(api.arena.replaceBrowserSessionEvents, {
    sessionId: sessionId as never,
    events,
  });
}

async function captureToBuffer(page: Page) {
  return await page.screenshot({
    fullPage: true,
    type: "png",
  });
}

async function persistFrame(args: {
  sessionId: string;
  screenshotPath: string;
  buffer: Buffer;
}) {
  const runtime = runtimeSessions.get(args.sessionId);
  if (!runtime) return;

  await fs.writeFile(args.screenshotPath, args.buffer);
  const viewport = runtime.page.viewportSize() ?? { width: 1440, height: 900 };
  const payload: BrowserStreamPayload = {
    frame: args.buffer.toString("base64"),
    mimeType: "image/png",
    timestamp: Date.now(),
    pointer: runtime.pointer
      ? {
          ...runtime.pointer,
          viewportWidth: viewport.width,
          viewportHeight: viewport.height,
        }
      : undefined,
  };
  payload.actionLabel = runtime.currentActionLabel;
  payload.visionDecision = runtime.visionDecision;
  runtime.latestPayload = payload;

  for (const listener of runtime.listeners) {
    try {
      listener(payload);
    } catch {}
  }
}

async function capture(sessionId: string) {
  const runtime = runtimeSessions.get(sessionId);
  if (!runtime) return;

  const buffer = await captureToBuffer(runtime.page);
  await persistFrame({
    sessionId,
    screenshotPath: runtime.screenshotPath,
    buffer,
  });
}

async function startLiveCaptureLoop(sessionId: string) {
  const runtime = runtimeSessions.get(sessionId);
  if (!runtime || runtime.captureLoop) return;

  runtime.captureLoop = setInterval(() => {
    void capture(sessionId).catch(() => {});
  }, 450);
}

async function updatePointer(
  sessionId: string,
  page: Page,
  args: { x: number; y: number; click?: boolean; dragging?: boolean },
) {
  const runtime = runtimeSessions.get(sessionId);
  if (!runtime) return;

  const previousTrail = runtime.pointer?.trail ?? [];
  const nextPoint = { x: args.x, y: args.y };
  const lastPoint = previousTrail[previousTrail.length - 1];
  const movedEnough =
    !lastPoint ||
    Math.hypot(lastPoint.x - nextPoint.x, lastPoint.y - nextPoint.y) > 6;
  const trail = movedEnough
    ? [...previousTrail.slice(-8), nextPoint]
    : previousTrail;

  runtime.pointerPulseId += args.click ? 1 : 0;
  runtime.pointer = {
    x: args.x,
    y: args.y,
    pulseId: runtime.pointerPulseId,
    clickAt: args.click ? Date.now() : runtime.pointer?.clickAt,
    dragging: args.dragging ?? false,
    trail,
    viewportWidth: page.viewportSize()?.width ?? 1440,
    viewportHeight: page.viewportSize()?.height ?? 900,
  };
}

function setActionLabel(sessionId: string, label: string | undefined) {
  const runtime = runtimeSessions.get(sessionId);
  if (!runtime) return;
  runtime.currentActionLabel = label;
}

async function movePointerWithTelemetry(args: {
  sessionId: string;
  page: Page;
  from?: { x: number; y: number };
  to: { x: number; y: number };
  steps?: number;
  dragging?: boolean;
}) {
  const { sessionId, page, to } = args;
  const from =
    args.from ??
    runtimeSessions.get(sessionId)?.pointer ?? {
      x: to.x,
      y: to.y,
    };
  const steps = Math.max(1, args.steps ?? 8);

  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    const x = from.x + (to.x - from.x) * progress;
    const y = from.y + (to.y - from.y) * progress;
    await updatePointer(sessionId, page, { x, y, dragging: args.dragging });
    await page.mouse.move(x, y, { steps: 1 });
  }
}

async function dragPointerWithTelemetry(args: {
  sessionId: string;
  page: Page;
  from: { x: number; y: number };
  to: { x: number; y: number };
  steps?: number;
}) {
  await movePointerWithTelemetry({
    sessionId: args.sessionId,
    page: args.page,
    from: args.from,
    to: args.from,
    steps: 1,
  });
  await args.page.mouse.down();
  await movePointerWithTelemetry({
    sessionId: args.sessionId,
    page: args.page,
    from: args.from,
    to: args.to,
    steps: args.steps ?? 12,
    dragging: true,
  });
  await updatePointer(args.sessionId, args.page, {
    x: args.to.x,
    y: args.to.y,
    dragging: true,
  });
  await args.page.mouse.up();
  await updatePointer(args.sessionId, args.page, {
    x: args.to.x,
    y: args.to.y,
    dragging: false,
  });
}

async function clickLocatorWithTelemetry(
  sessionId: string,
  page: Page,
  locator: Locator,
) {
  const box = await locator.boundingBox().catch(() => null);
  if (!box) {
    await locator.click();
    return;
  }

  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await movePointerWithTelemetry({
    sessionId,
    page,
    to: { x, y },
    steps: 8,
  });
  await page.waitForTimeout(80);
  await updatePointer(sessionId, page, { x, y, click: true });
  await page.mouse.click(x, y);
}

async function clickIfVisible(page: Page, selectors: string[]) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0 && (await locator.isVisible())) {
      await locator.click();
      return true;
    }
  }

  return false;
}

async function fillIfVisible(page: Page, selectors: string[], value: string) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0 && (await locator.isVisible())) {
      await locator.fill(value);
      return true;
    }
  }

  return false;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function clickLocatorIfVisible(frame: Frame, selectors: string[]) {
  for (const selector of selectors) {
    const locator = frame.locator(selector).first();
    try {
      if ((await locator.count()) > 0 && (await locator.isVisible())) {
        await locator.click();
        return true;
      }
    } catch {}
  }

  return false;
}

function getChartFrame(page: Page) {
  const chartFrame = page
    .frames()
    .find((frame) => frame.url().startsWith("blob:https://charts.deriv.com/"));

  if (!chartFrame) {
    throw new Error("Could not locate the embedded Deriv chart frame.");
  }

  return chartFrame;
}

async function switchDerivSymbol(
  sessionId: string,
  page: Page,
  marketSymbol: string,
) {
  const chartFrame = getChartFrame(page);
  await page.waitForTimeout(1200);

  setActionLabel(sessionId, "Opening symbol search");
  const symbolSearchButton = chartFrame.getByRole("button", { name: "Symbol Search" });
  const openedSelector = await clickLocatorWithTelemetry(
    sessionId,
    page,
    symbolSearchButton,
  )
    .then(() => true)
    .catch(() => false);

  if (!openedSelector) {
    throw new Error("Could not open the Deriv market selector.");
  }

  await page.waitForTimeout(800);

  setActionLabel(sessionId, "Navigating to Derived markets");
  await clickLocatorWithTelemetry(
    sessionId,
    page,
    chartFrame.getByText(/^Derived$/).first(),
  ).catch(() => {});

  await page.waitForTimeout(400);

  setActionLabel(sessionId, `Searching for ${marketSymbol}`);
  const searchInput = chartFrame.locator('input[placeholder="Search"]').first();
  const filledSearch = await searchInput
    .fill(marketSymbol)
    .then(() => true)
    .catch(() => false);

  if (!filledSearch) {
    throw new Error("Could not find the Deriv symbol search input.");
  }

  await page.waitForTimeout(1200);

  setActionLabel(sessionId, `Selecting ${marketSymbol} from results`);
  const exactSymbolPattern = new RegExp(escapeRegExp(marketSymbol), "i");
  const selectedSymbol = await clickLocatorWithTelemetry(
    sessionId,
    page,
    chartFrame.getByText(exactSymbolPattern, { exact: false }).first(),
  )
    .then(() => true)
    .catch(() => false);

  if (!selectedSymbol) {
    throw new Error(`Could not select Deriv market "${marketSymbol}".`);
  }

  setActionLabel(sessionId, "Waiting for chart to load");
  await page.waitForTimeout(1500);
}

async function switchDerivTimeframe(
  sessionId: string,
  page: Page,
  timeframe: string,
) {
  const chartFrame = getChartFrame(page);
  const resolutionMap: Record<string, string> = {
    "15m": "15",
    "1h": "60",
    "4h": "240",
    "8h": "480",
    "24h": "1440",
  };
  const resolution = resolutionMap[timeframe];

  if (!resolution) {
    throw new Error(`Unsupported Deriv timeframe "${timeframe}".`);
  }

  setActionLabel(sessionId, `Opening interval selector for ${timeframe}`);
  const frameBody = chartFrame.locator("body");

  // Click the chart body to ensure focus before opening the dialog.
  // Use the centre of the chart area (not the toolbar region).
  const bodyBox = await frameBody.boundingBox().catch(() => null);
  if (bodyBox) {
    const x = bodyBox.x + bodyBox.width * 0.5;
    const y = bodyBox.y + bodyBox.height * 0.3;
    await movePointerWithTelemetry({ sessionId, page, to: { x, y }, steps: 6 });
    await updatePointer(sessionId, page, { x, y, click: true });
  }
  await frameBody.click();
  await page.waitForTimeout(300); // let focus settle before opening dialog
  await chartFrame.locator("body").press(",");
  await page.waitForTimeout(1000); // wait for dialog to fully appear

  setActionLabel(sessionId, `Setting ${timeframe} interval (${resolution} min)`);
  const intervalInput = chartFrame.locator("input").first();

  // Clear any existing value before filling to avoid partial-match issues.
  await intervalInput.selectText().catch(() => null);
  const filled = await intervalInput
    .fill(resolution)
    .then(() => true)
    .catch(() => false);

  if (!filled) {
    throw new Error("Could not access the Deriv interval input.");
  }

  await page.waitForTimeout(300); // let dialog register the new value
  setActionLabel(sessionId, `Confirming ${timeframe} timeframe`);
  await intervalInput.press("Enter");
  await page.waitForTimeout(2000); // wait for chart to re-render at new timeframe
  console.log(`[switchDerivTimeframe] set to ${timeframe} (${resolution} min)`);

  // Dismiss any onboarding overlays that Deriv/TradingView shows after a timeframe switch.
  // These cover the chart and must be cleared before taking screenshots.
  await dismissDerivTooltips(page);
}

export type SwingPointsForBrowser = {
  t1Price: number;
  t1TimeSec?: number;
  t2Price: number;
  t2TimeSec?: number;
  projectedPrice: number;
  t3TimeSec?: number;
  zoneLow: number;
  zoneHigh: number;
  direction: "long" | "short";
  visiblePriceLow: number;
  visiblePriceHigh: number;
  candleSeconds: number; // e.g. 14400 for 4h
};

type ChartStructureOverlay = {
  structureStatus: ChartVisionDecision["structureStatus"];
  verdict: ChartVisionDecision["verdict"];
  invalidationZone?: {
    low: number;
    high: number;
    note: string;
  };
  invalidationNote?: string;
  // Pixel positions reported by the vision agent for T1/T2 in View 6 (the final screenshot).
  // xPct/yPct are fractions of the 1440×900 viewport — used directly as page.mouse.click coords.
  t1ViewSixPos?: { xPct: number; yPct: number };
  t2ViewSixPos?: { xPct: number; yPct: number };
  // ISO date strings ("YYYY-MM-DD") from the agent — used when viewSixPos is null
  // (anchor off-screen) to compute Unix timestamps directly for createMultipointShape.
  t1Date?: string;
  t2Date?: string;
};

async function panChartForReview(sessionId: string, page: Page) {
  const viewport = page.viewportSize() ?? { width: 1440, height: 900 };
  // Chart canvas centre — avoid the price axis on the right (~80px) and toolbars (~55px top)
  const chartCx = viewport.width * 0.45;
  const chartCy = viewport.height * 0.48;

  setActionLabel(sessionId, "Scanning historical structure");
  // Drag right: pulls older candles into view
  await dragPointerWithTelemetry({
    sessionId,
    page,
    from: { x: chartCx, y: chartCy },
    to: { x: chartCx + 340, y: chartCy },
    steps: 22,
  });
  await page.waitForTimeout(500);

  setActionLabel(sessionId, "Zooming to inspect candle detail");
  // Scroll up on chart area = zoom in on the time axis in TradingView
  await movePointerWithTelemetry({ sessionId, page, to: { x: chartCx, y: chartCy }, steps: 6 });
  await page.mouse.wheel(0, -180);
  await page.waitForTimeout(400);

  setActionLabel(sessionId, "Settling on recent price action");
  // Drag back left to recentre on current price
  await dragPointerWithTelemetry({
    sessionId,
    page,
    from: { x: chartCx + 340, y: chartCy },
    to: { x: chartCx + 160, y: chartCy },
    steps: 14,
  });
  await page.waitForTimeout(600);

  setActionLabel(sessionId, undefined);
}

async function dismissDerivTooltips(page: Page, chartFrame?: ReturnType<typeof getChartFrame>) {
  // Deriv/TradingView shows onboarding overlays after timeframe switches:
  //   - Blue "Press and hold to see detailed chart values" modal with a "Got it!" button
  //   - Bottom banner "Press and hold Ctrl while zooming…" with an × close button
  // These must be dismissed before taking screenshots or drawing, otherwise they
  // occlude the chart and degrade Sonnet/Haiku's visual analysis.
  const dismissSelectors = [
    'button:has-text("Got it!")',
    'button:has-text("Got it")',
    'button:has-text("OK")',
    '[aria-label="Close"]',
    '[aria-label="close"]',
    'button.close',
    '.tooltip__close',
    '.modal__close',
    // TradingView Ctrl-zoom banner and similar notification close buttons
    'button[class*="close"]',
    'span[class*="close"]',
    // Generic × / ✕ close glyphs (TradingView uses these on floating banners)
    'button:has-text("×")',
    'button:has-text("✕")',
  ];

  // Always search inside the chart iframe — both overlays render there.
  const frame = chartFrame ?? getChartFrame(page);
  const roots: Array<Page | ReturnType<typeof getChartFrame>> = [page, frame];

  for (const root of roots) {
    for (const selector of dismissSelectors) {
      try {
        const buttons = root.locator(selector);
        const count = await buttons.count().catch(() => 0);
        for (let i = 0; i < count; i++) {
          const btn = buttons.nth(i);
          const visible = await btn.isVisible().catch(() => false);
          if (visible) {
            await btn.click({ force: true }).catch(() => {});
          }
        }
      } catch {
        // ignore per-selector failures
      }
    }
  }
  // No keyboard Escape — it would cancel any active drawing tool.
  await page.waitForTimeout(300);
}

async function autoScaleYAxis(page: Page) {
  // Double-clicking the right price axis triggers TradingView's auto-fit,
  // ensuring all visible candle wicks are within the viewport after every pan.
  const viewport = page.viewportSize() ?? { width: 1440, height: 900 };
  const axisX = viewport.width - 50;
  const axisY = viewport.height * 0.5;
  await page.mouse.dblclick(axisX, axisY);
  await page.waitForTimeout(300);
}

async function captureStrategyScreenshots(
  sessionId: string,
  page: Page,
  targetTimeframe: string,
): Promise<Buffer[]> {
  const viewport = page.viewportSize() ?? { width: 1440, height: 900 };
  const chartCx = viewport.width * 0.44;
  const chartCy = viewport.height * 0.47;
  const screenshots: Buffer[] = [];

  const chartFrame = getChartFrame(page);
  await dismissDerivTooltips(page, chartFrame);

  async function snap(label: string): Promise<void> {
    // Always dismiss overlays before capturing — Deriv shows onboarding modals
    // after timeframe switches that occlude the chart and degrade vision analysis.
    await dismissDerivTooltips(page, chartFrame);
    await autoScaleYAxis(page);
    setActionLabel(sessionId, label);
    await page.waitForTimeout(800);
    screenshots.push(await captureToBuffer(page));
  }

  // ── Phase 1: 8h — expose the full available history ──────────────────────────
  // 8h candles cover many months per screen. Heavy zoom-out + one pan left
  // exposes the oldest available data so Sonnet can identify the true T1 origin.
  setActionLabel(sessionId, "Switching to 8h for full historical regime context");
  await switchDerivTimeframe(sessionId, page, "8h");
  await page.waitForTimeout(300);
  // Click chart frame centre to restore focus after the interval dialog closes.
  const frameBox8h = await chartFrame.locator("body").boundingBox().catch(() => null);
  const f8hCx = frameBox8h ? frameBox8h.x + frameBox8h.width * 0.5 : chartCx;
  const f8hCy = frameBox8h ? frameBox8h.y + frameBox8h.height * 0.4 : chartCy;
  // Extra tooltip dismissal pass — the "Got it!" modal sometimes appears with a
  // short delay after the timeframe switch and can block all wheel/drag events.
  await page.waitForTimeout(1200);
  await dismissDerivTooltips(page, chartFrame);
  await page.waitForTimeout(300);
  await page.mouse.click(f8hCx, f8hCy);
  await page.waitForTimeout(200);
  await page.mouse.move(f8hCx, f8hCy);
  await page.mouse.wheel(0, 3500); // zoom out on 8h
  await page.waitForTimeout(700);
  await snap("View 1/6 — 8h broad view: full recent regime, dominant swings and trend structure");

  // Pan left to reach the end of available history on this instrument.
  setActionLabel(sessionId, "Panning 8h to oldest available data — end of history");
  await dragPointerWithTelemetry({
    sessionId, page,
    from: { x: chartCx, y: chartCy },
    to: { x: chartCx + 1200, y: chartCy },
    steps: 50,
  });
  await snap("View 2/6 — 8h oldest available history: absolute origin of the trend, dominant mega-swing visible");

  // ── Phase 2: Return to trading timeframe — show full structure from T1 to now ──
  // After switching timeframe, click the "6m" period button if available (it
  // puts the full 6-month window in frame, which always includes the oldest
  // structural swing). Fall back to heavy wheel zoom-out + extra pan left.
  setActionLabel(sessionId, `Switching to ${targetTimeframe} — showing full structure from T1 to present`);
  await switchDerivTimeframe(sessionId, page, targetTimeframe);
  await page.waitForTimeout(500);

  // After a timeframe switch, the chart frame loses focus (the interval dialog
  // had focus). Wheel scroll only zooms the chart when the frame has focus.
  // Get the frame's actual page coordinates, click its centre to restore focus,
  // then wheel-zoom while the cursor is positioned over the canvas.
  const frameBox = await chartFrame.locator("body").boundingBox().catch(() => null);
  const fCx = frameBox ? frameBox.x + frameBox.width * 0.5 : chartCx;
  const fCy = frameBox ? frameBox.y + frameBox.height * 0.4 : chartCy;

  // Extra tooltip dismissal pass before the zoom — the "Got it!" modal blocks
  // wheel events if it's still up when we try to scroll.
  await page.waitForTimeout(1200);
  await dismissDerivTooltips(page, chartFrame);
  await page.waitForTimeout(300);
  await page.mouse.click(fCx, fCy);   // restore focus to chart frame
  await page.waitForTimeout(200);
  await page.mouse.move(fCx, fCy);

  // Zoom out heavily on the trading timeframe so the structural T1 (which may be
  // 10+ weeks back) is visible. wheel(0, positive) = zoom OUT on TradingView/Deriv.
  // Using 8000 (was 5000) to show ~3 months of 4h candles — enough to expose a
  // Feb T1 when current date is late April.
  await page.mouse.wheel(0, 8000);
  await page.waitForTimeout(900);
  // Pan left (drag right) to shift older history into the left side of the frame.
  await dragPointerWithTelemetry({
    sessionId, page,
    from: { x: fCx, y: fCy },
    to: { x: fCx + 700, y: fCy },
    steps: 35,
  });
  await page.waitForTimeout(400);
  console.log("[captureStrategyScreenshots] zoomed out and panned left on", targetTimeframe);
  await snap(`View 3/6 — ${targetTimeframe} full structure: oldest dominant swing (T1) on left, current price on right`);

  // Pan left a bit more to bring T1 clearly into frame without clipping.
  setActionLabel(sessionId, "Centering on T1 — oldest structural anchor");
  await dragPointerWithTelemetry({
    sessionId, page,
    from: { x: chartCx, y: chartCy },
    to: { x: chartCx + 300, y: chartCy },
    steps: 15,
  });
  await snap(`View 4/6 — ${targetTimeframe} T1 region: oldest dominant structural swing centred, T2 visible to the right`);

  // Pan right (drag left) to expose the T1→T2 slope and post-T2 price action.
  setActionLabel(sessionId, "Advancing to T1→T2 span — slope and post-T2 behaviour");
  await dragPointerWithTelemetry({
    sessionId, page,
    from: { x: chartCx, y: chartCy },
    to: { x: chartCx - 500, y: chartCy },
    steps: 25,
  });
  await snap(`View 5/6 — ${targetTimeframe} T1→T2 slope and post-T2 line interaction, T3 region approaching`);

  // ── Phase 3: Drawing canvas ───────────────────────────────────────────────────
  // Pan left (drag right) 600px so T1 is back near the left side of the canvas
  // and current price is near the right. This is the CRITICAL view — Sonnet
  // reports viewSixPos from this screenshot as mouse-click targets for drawing.
  // Using 600px (was 200px) to pull far enough back so T1 (~Feb 7) is on-screen.
  setActionLabel(sessionId, "Settling to drawing canvas — T1 on left, T3 zone on right");
  await dragPointerWithTelemetry({
    sessionId, page,
    from: { x: chartCx, y: chartCy },
    to: { x: chartCx + 600, y: chartCy },
    steps: 25,
  });
  await snap(`View 6/6 — ${targetTimeframe} DRAWING CANVAS: T1 (oldest low) on left, T2 in mid, T3 zone and current price on right`);

  return screenshots;
}

async function saveDrawingCheckpoint(
  sessionId: string,
  page: Page,
  label: string,
): Promise<void> {
  try {
    const dir = path.join(SCREENSHOT_ROOT, "drawing-debug");
    await fs.mkdir(dir, { recursive: true });
    const slug = label.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
    const filename = `${sessionId}_${Date.now()}_${slug}.png`;
    const buffer = await page.screenshot({ type: "png" });
    await fs.writeFile(path.join(dir, filename), buffer);
    console.log(`[drawing-debug] checkpoint: ${filename}`);
  } catch (err) {
    console.warn("[drawing-debug] checkpoint save failed:", err);
  }
}

type ToolActivationResult = "shortcut" | "toolbar" | "unknown";

async function activateDrawingTool(
  sessionId: string,
  page: Page,
  chartFrame: ReturnType<typeof getChartFrame>,
  tool: "trendline" | "rectangle",
  chartCx: number,
  chartCy: number,
): Promise<ToolActivationResult> {
  // keyboard shortcuts for the Deriv/TradingView chart
  const shortcut = tool === "trendline" ? "Alt+t" : "Alt+Shift+r";

  // toolbar button selectors — tried in order as fallback
  const toolbarSelectors =
    tool === "trendline"
      ? [
          '[data-name="trend-line-tool"]',
          '[data-tooltip*="Trend"]',
          'button[title*="Trend"]',
          'button[aria-label*="Trend"]',
        ]
      : [
          '[data-name="rect-tool"]',
          '[data-name="rectangle-tool"]',
          '[data-tooltip*="Rectangle"]',
          'button[title*="Rectangle"]',
          'button[aria-label*="Rectangle"]',
        ];

  // Ensure the chart iframe has focus before sending keyboard events
  await page.mouse.click(chartCx, chartCy);
  await page.waitForTimeout(200);

  // Try via page-level keyboard (original path)
  await page.keyboard.press(shortcut).catch(() => {});
  await page.waitForTimeout(200);

  // Also try via the frame body — more reliable when the iframe owns focus
  await chartFrame.locator("body").press(shortcut).catch(() => {});
  await page.waitForTimeout(400);

  await dismissDerivTooltips(page, chartFrame);
  await saveDrawingCheckpoint(sessionId, page, `tool_activate_${tool}_shortcut`);

  // Check if any toolbar button for this tool is now in an active/pressed state
  const activeViaShortcut = await chartFrame.evaluate((selectors: string[]) => {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      if (
        el.classList.contains("active") ||
        el.getAttribute("data-active") === "true" ||
        el.getAttribute("aria-pressed") === "true" ||
        el.getAttribute("data-selected") === "true"
      ) {
        return true;
      }
    }
    return false;
  }, toolbarSelectors).catch(() => false);

  if (activeViaShortcut) {
    console.log(`[drawing] ${tool} activated via keyboard shortcut`);
    return "shortcut";
  }

  console.log(`[drawing] ${tool} shortcut did not confirm active — trying toolbar click`);

  // Fallback: click the toolbar button directly
  for (const selector of toolbarSelectors) {
    const locator = chartFrame.locator(selector).first();
    try {
      const count = await locator.count();
      if (count === 0) continue;
      const visible = await locator.isVisible().catch(() => false);
      if (!visible) continue;
      const box = await locator.boundingBox().catch(() => null);
      if (!box) continue;

      const bx = box.x + box.width / 2;
      const by = box.y + box.height / 2;
      await movePointerWithTelemetry({ sessionId, page, to: { x: bx, y: by }, steps: 8 });
      await updatePointer(sessionId, page, { x: bx, y: by, click: true });
      await locator.click();
      await page.waitForTimeout(400);

      // The trendline toolbar button opens a "Lines" sub-panel rather than
      // activating the tool directly. Detect this and select "Trend Line" from it.
      if (tool === "trendline") {
        const trendLineItem = chartFrame.getByText("Trend Line", { exact: true }).first();
        const submenuOpen = await trendLineItem.isVisible().catch(() => false);
        if (submenuOpen) {
          // force:true skips actionability checks (the highlighted item can still
          // be clicked immediately). timeout:3000 prevents a 30-second Playwright
          // wait that caused the 50-second trendline activation delay.
          await trendLineItem.click({ force: true, timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(300);
          console.log("[drawing] trendline selected from Lines sub-panel");
        }
      }

      await dismissDerivTooltips(page, chartFrame);
      await saveDrawingCheckpoint(sessionId, page, `tool_activate_${tool}_toolbar`);
      console.log(`[drawing] ${tool} activated via toolbar button (${selector})`);
      return "toolbar";
    } catch {
      continue;
    }
  }

  // Could not confirm activation — proceed anyway and let post-draw checkpoint reveal result
  console.log(`[drawing] ${tool} activation could not be confirmed — proceeding`);
  return "unknown";
}

// Move the cursor to (x, y) and read the price shown on the right axis crosshair.
// Returns null if no price label is found near the cursor's Y.
async function probeCursorPrice(
  page: Page,
  chartFrame: ReturnType<typeof getChartFrame>,
  x: number,
  y: number,
  iframeOffsetY: number,
): Promise<number | null> {
  await page.mouse.move(x, y);
  await page.waitForTimeout(250);

  const frameY = y - iframeOffsetY;

  const result = await chartFrame.evaluate((targetFrameY: number) => {
    const axisXMin = window.innerWidth * 0.78;
    let closest: { price: number; dist: number } | null = null;
    const seen = new Set<string>();

    for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
      const r = el.getBoundingClientRect();
      if (
        r.left < axisXMin ||
        r.width === 0 ||
        r.height < 4 ||
        r.height > 40 ||
        r.top < 0 ||
        r.bottom > window.innerHeight
      ) continue;

      const text = el.textContent?.trim() ?? "";
      if (!text || !/^[\d,\.]+$/.test(text) || seen.has(text)) continue;
      seen.add(text);

      const price = parseFloat(text.replace(/,/g, ""));
      if (isNaN(price) || price < 100 || price > 1_000_000) continue;

      const labelY = r.top + r.height / 2;
      const dist = Math.abs(labelY - targetFrameY);

      if (!closest || dist < closest.dist) {
        closest = { price, dist };
      }
    }

    return closest ?? null;
  }, frameY);

  if (!result) return null;

  // Only trust the label if it is within 25px of the cursor — that is the cursor
  // crosshair label, not an unrelated static label further away.
  return result.dist < 25 ? result.price : null;
}

// Binary search in Y (page coordinates) to find the position where the chart's
// right-axis crosshair shows targetPrice. Returns null if probing yields no DOM
// results (canvas-rendered axis) — caller should keep the initial estimate.
async function binarySearchYForPrice(
  sessionId: string,
  page: Page,
  chartFrame: ReturnType<typeof getChartFrame>,
  x: number,
  targetPrice: number,
  iframeOffsetY: number,
  yRange: [number, number], // [yMin, yMax] — yMin = top = highest price
  maxIter = 12,
): Promise<number | null> {
  let lo = yRange[0]; // small y = high price in TradingView
  let hi = yRange[1]; // large y = low price

  let lastKnownPrice: number | null = null;

  for (let i = 0; i < maxIter; i++) {
    const mid = Math.round((lo + hi) / 2);
    const price = await probeCursorPrice(page, chartFrame, x, mid, iframeOffsetY);

    if (price === null) {
      // DOM returned nothing — likely canvas rendering; give up after first miss
      if (i === 0) {
        console.log(`[cursor-probe] DOM returned no price labels — falling back (sessionId=${sessionId})`);
        return null;
      }
      // Subsequent misses: price axis became clipped; stop here
      break;
    }

    lastKnownPrice = price;
    const tolerance = targetPrice * 0.001; // 0.1% tolerance
    console.log(`[cursor-probe] iter ${i}: y=${mid} price=${price} target=${targetPrice} dist=${Math.abs(price - targetPrice).toFixed(2)}`);

    if (Math.abs(price - targetPrice) <= tolerance) {
      return mid;
    }

    // Higher price → lower y (higher on screen). If price > target, go down (increase y).
    if (price > targetPrice) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }

    if (lo > hi) break;
  }

  console.log(`[cursor-probe] converged: lastPrice=${lastKnownPrice} target=${targetPrice} y=${Math.round((lo + hi) / 2)}`);
  return Math.round((lo + hi) / 2);
}

// Send the current page screenshot to claude-haiku-4-5 and ask it to identify
// the exact pixel coordinates of the target anchor candle. Haiku sees the live
// chart state, so it is immune to scroll drift between the vision screenshots
// and drawing time. Returns null if the target is not visible or the call fails.
async function locateAnchorWithHaiku(
  page: Page,
  targetPrice: number,
  isLong: boolean,
  anchorLabel: string, // "T1" or "T2"
  anchorDescription: string, // e.g. "major swing low around Mar 13"
): Promise<{ x: number; y: number } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  let screenshot: Buffer;
  try {
    screenshot = await page.screenshot({ type: "png" });
  } catch {
    return null;
  }

  const swingType = isLong ? "swing LOW (trough)" : "swing HIGH (peak)";
  const wickInstruction = isLong
    ? "Return the coordinates of the BOTTOM tip of the lower wick"
    : "Return the coordinates of the TOP tip of the upper wick";

  const systemPrompt = `You are a coordinate extraction tool for financial charts. You ONLY output JSON. Never explain, never reason aloud. Output format is always: {"x": <integer>, "y": <integer>} or {"x": null, "y": null}`;

  const prompt = `Chart screenshot is 1440×900 px.
Chart canvas: x=130–1140, y=160–615. Price axis at x>1140. Time axis at y>615.

Find ${anchorLabel}: the ${swingType} candle at price ~${targetPrice.toLocaleString()}.
Context: ${anchorDescription}

Use the price axis labels to calibrate Y, date labels to calibrate X.
${wickInstruction} of that candle.
x must be 130–1140, y must be 160–615.
If not visible: {"x": null, "y": null}

JSON only:`;

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 32,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: screenshot.toString("base64"),
              },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    });

    const text = response.content.find((b) => b.type === "text")?.text ?? "";
    console.log(`[haiku-locate] ${anchorLabel} raw: ${text.trim()}`);

    const jsonMatch = text.match(/\{[^}]+\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as { x: number | null; y: number | null };
    if (parsed.x === null || parsed.y === null) {
      console.log(`[haiku-locate] ${anchorLabel} not visible in current view`);
      return null;
    }
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number") return null;

    // Clamp to valid chart canvas area
    const x = Math.round(Math.max(130, Math.min(1140, parsed.x)));
    const y = Math.round(Math.max(160, Math.min(615, parsed.y)));

    console.log(`[haiku-locate] ${anchorLabel} at (${x}, ${y}) for price ${targetPrice}`);
    return { x, y };
  } catch (err) {
    console.error("[haiku-locate] error:", err);
    return null;
  }
}

// Draw the trendline and zone box using the TradingView Charting Library JS API
// instead of mouse automation. Requires window.__gildoreWidget to be set by the
// addInitScript interceptor. Returns true on success.
//
// IMPORTANT: TradingView CL runs inside the blob: iframe, NOT the main page.
// All evaluation must happen in chartFrame context, not page context.
//
// xPct values come from Sonnet's viewSixPos for the View-6 screenshot, which is
// the current visible chart state. chart.getVisibleRange() returns the same range,
// so linear interpolation gives accurate bar timestamps (exact for 24/7 markets).
async function drawWithChartApi(
  page: Page,
  sessionId: string,
  // xPct: viewport fraction from Sonnet's viewSixPos (requires chart in View-6 state)
  // dateUtcSec: Unix timestamp from agent's ISO date — works regardless of chart state
  t1: { price: number; xPct?: number; dateUtcSec?: number },
  t2: { price: number; xPct?: number; dateUtcSec?: number },
  zone: { low: number; high: number },
): Promise<boolean> {
  try {
    // TradingView CL widget lives in the blob: iframe — evaluate there.
    let chartFrame: ReturnType<typeof getChartFrame>;
    try {
      chartFrame = getChartFrame(page);
    } catch (err) {
      console.error("[drawing-api] chart frame not found:", err);
      return false;
    }

    // Diagnostic: check widget availability before attempting to draw
    const widgetCheck = await chartFrame.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      return {
        hasGildoreWidget: Boolean(w.__gildoreWidget),
        hasTVNamespace: Boolean(w.TradingView),
        hasTVWidget: Boolean(w.TradingView?.widget),
      };
    }).catch(() => ({ hasGildoreWidget: false, hasTVNamespace: false, hasTVWidget: false }));
    console.log("[drawing-api] widget check:", widgetCheck);

    const result = await chartFrame.evaluate(
      ({ t1, t2, zone }: {
        t1: { price: number; xPct?: number; dateUtcSec?: number };
        t2: { price: number; xPct?: number; dateUtcSec?: number };
        zone: { low: number; high: number };
      }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        let widget = w.__gildoreWidget;

        // Fallback: addInitScript may have had a race on the blob frame — scan top-level
        // window properties for an object that looks like a TradingView CL widget instance
        // (has activeChart + chart + onChartReady + subscribe methods).
        if (!widget) {
          const tvMethods = ["activeChart", "chart", "onChartReady", "headerReady", "subscribe"];
          for (const key of Object.getOwnPropertyNames(w)) {
            if (key.startsWith("__") || key === "window" || key === "self") continue;
            try {
              const val = w[key];
              if (val && typeof val === "object" && !Array.isArray(val)) {
                const matches = tvMethods.filter((m) => typeof val[m] === "function").length;
                if (matches >= 3) {
                  w.__gildoreWidget = val;
                  widget = val;
                  break;
                }
              }
            } catch { /* skip non-accessible properties */ }
          }
        }

        if (!widget) return { ok: false, reason: "widget not found in iframe" };

        // Guard: if T1 and T2 have the same (or nearly same) price the agent
        // approximated T1 as the leftmost visible candle — skip drawing to avoid
        // a flat horizontal line and let the fallback handle it.
        if (Math.abs(t1.price - t2.price) < t1.price * 0.003) {
          return { ok: false, reason: "T1 and T2 prices are identical — agent used leftmost-candle approximation" };
        }

        let chart: ReturnType<typeof widget.activeChart>;
        try { chart = widget.activeChart(); } catch (e) {
          return { ok: false, reason: "activeChart() failed: " + String(e) };
        }

        const range = chart.getVisibleRange() as { from: number; to: number } | null;
        if (!range?.from || !range?.to) return { ok: false, reason: "no visible range" };

        const span = range.to - range.from;

        // Convert viewport xPct → Unix timestamp.
        // Chart canvas occupies x=0.11–0.93 of the viewport (toolbar left, price axis right).
        const CHART_L = 0.11;
        const CHART_R = 0.93;
        const xPctToTime = (xPct: number) => {
          const canvasFrac = (xPct - CHART_L) / (CHART_R - CHART_L);
          return Math.round(range.from + span * Math.max(0, Math.min(1, canvasFrac)));
        };

        // Prefer date-based timestamp (absolute, chart-state-independent) over xPct
        // interpolation (requires chart to still be in View-6 state).
        const t1Time = t1.dateUtcSec ?? (t1.xPct !== undefined ? xPctToTime(t1.xPct) : null);
        const t2Time = t2.dateUtcSec ?? (t2.xPct !== undefined ? xPctToTime(t2.xPct) : null);
        if (!t1Time || !t2Time) return { ok: false, reason: "no time source for T1 or T2" };

        // Zone always at the right side of the chart — the T3 interaction area.
        const zoneStartTime = Math.round(range.from + span * 0.80);
        const zoneEndTime   = Math.round(range.from + span * 0.97);

        // Slope sanity: skip if T1 and T2 resolve to same timestamp or nearly same price
        if (t2Time <= t1Time) return { ok: false, reason: "T2 timestamp ≤ T1 — inverted or same time" };

        // Clear any drawings from previous sessions
        chart.removeAllShapes();

        // Draw ascending/descending support trendline, extended to the right
        chart.createMultipointShape(
          [{ time: t1Time, price: t1.price }, { time: t2Time, price: t2.price }],
          {
            shape: "trend_line",
            overrides: {
              linecolor: "rgba(88, 152, 255, 1)",
              linewidth: 2,
              linestyle: 0,
              extendRight: true,
              showLabel: false,
            },
          },
        );

        // Draw projected interaction zone as a rectangle at the T3 area (right side of chart)
        chart.createMultipointShape(
          [{ time: zoneStartTime, price: zone.low }, { time: zoneEndTime, price: zone.high }],
          {
            shape: "rectangle",
            overrides: {
              backgroundColor: "rgba(142, 124, 195, 0.2)",
              borderColor: "rgba(142, 124, 195, 0.8)",
              linewidth: 1,
              showLabel: false,
            },
          },
        );

        // After drawing, set the visible range so T1 is near the left edge and
        // current time is near the right — gives the user a natural view of the
        // full structure without needing to manually zoom/pan.
        const nowSec = Math.floor(Date.now() / 1000);
        const paddingLeft = t1Time - (nowSec - t1Time) * 0.15;  // 15% of total span before T1
        const paddingRight = nowSec + (nowSec - t1Time) * 0.05; // 5% after current date
        try {
          chart.setVisibleRange({ from: Math.round(paddingLeft), to: Math.round(paddingRight) });
        } catch { /* non-fatal — chart may not support setVisibleRange */ }

        return { ok: true, t1Time, t2Time, range };
      },
      { t1, t2, zone } as { t1: { price: number; xPct?: number; dateUtcSec?: number }; t2: { price: number; xPct?: number; dateUtcSec?: number }; zone: { low: number; high: number } },
    );

    console.log("[drawing-api]", result);
    return (result as { ok: boolean }).ok;
  } catch (err) {
    console.error("[drawing-api] error:", err);
    return false;
  }
}

async function identifySwingPointsOnChart(
  sessionId: string,
  page: Page,
  sp: SwingPointsForBrowser,
  overlay?: ChartStructureOverlay,
) {
  const viewport = page.viewportSize() ?? { width: 1440, height: 900 };

  // Chart canvas bounds — skip drawing toolbar (left) and price axis (right)
  const CL = 160;
  const CR = viewport.width - 90;
  const CT = 58;
  const CB = viewport.height - 38;
  const CW = CR - CL;
  const CH = CB - CT;
  const chartCx = CL + CW * 0.5;
  const chartCy = CT + CH * 0.5;

  // ── 1. Prepare chart view ──────────────────────────────────────────────────
  // Evaluate agent position availability before changing the view, since the
  // agent positions reference the chart state as of View 6 (last screenshot).
  const agentT1Pos = overlay?.t1ViewSixPos;
  const agentT2Pos = overlay?.t2ViewSixPos;
  const hasAgentPositions = agentT1Pos !== undefined && agentT2Pos !== undefined;

  setActionLabel(sessionId, "Settling chart for structure marking");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  const chartFrame = getChartFrame(page);

  if (hasAgentPositions) {
    // View 6 was taken at the 3m settled view — the chart is still in that state.
    // Preserve it exactly: Sonnet's viewSixPos targets those pixel positions.
    setActionLabel(sessionId, "Preserving 3m drawing canvas from View 6 — agent positions ready");
    await dismissDerivTooltips(page, chartFrame);
  } else {
    // No agent pixel positions — zoom out to show the full structure.
    // Do NOT click period presets ("3m", "6m") — they cause unexpected
    // timeframe changes on Deriv's embedded TradingView chart.
    setActionLabel(sessionId, "Zooming to drawing canvas — full structure visibility");
    await movePointerWithTelemetry({ sessionId, page, to: { x: chartCx, y: chartCy }, steps: 6 });
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(700);
    await autoScaleYAxis(page);
    await page.waitForTimeout(400);
    await dismissDerivTooltips(page, chartFrame);
  }

  await saveDrawingCheckpoint(sessionId, page, "01_settled_view");

  // ── 2. Calibrate Y via geometry — no CSS class dependency ────────────────
  // Scan the right 20% of the iframe for elements containing numeric text
  // (the price axis labels). getBoundingClientRect() returns frame-relative Y.
  // We add the iframe's page-level Y offset to get coordinates matching
  // page.mouse.click(x, y). Only needed in fallback (non-agent) path.

  let priceToY: (price: number) => number;

  if (!hasAgentPositions) {
    const iframeOffset = await page.evaluate(() => {
      const blob = Array.from(document.querySelectorAll("iframe")).find((f) =>
        f.src.startsWith("blob:"),
      );
      if (blob) {
        const r = blob.getBoundingClientRect();
        return { x: r.left, y: r.top };
      }
      return { x: 0, y: 0 };
    }).catch(() => ({ x: 0, y: 0 }));

    const rawCalibrationPts = await chartFrame.evaluate(() => {
      const axisXThreshold = window.innerWidth * 0.78;
      const results: Array<{ price: number; frameY: number }> = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
        const r = el.getBoundingClientRect();
        if (
          r.left < axisXThreshold || r.width === 0 || r.height < 4 ||
          r.height > 40 || r.top < 0 || r.bottom > window.innerHeight
        ) continue;
        const text = el.textContent?.trim() ?? "";
        const price = parseFloat(text.replace(/,/g, ""));
        if (!isNaN(price) && price > 100 && price < 1_000_000 && /^[\d,\.]+$/.test(text)) {
          results.push({ price, frameY: r.top + r.height / 2 });
        }
      }
      return results;
    }).catch(() => [] as Array<{ price: number; frameY: number }>);

    const calPts = rawCalibrationPts.map((pt) => ({
      price: pt.price,
      y: iframeOffset.y + pt.frameY,
    }));
    const topClamp = iframeOffset.y + CT + 12;
    const botClamp = iframeOffset.y + CB - 12;

    if (calPts.length >= 2) {
      const n = calPts.length;
      const sumX = calPts.reduce((s, p) => s + p.price, 0);
      const sumY = calPts.reduce((s, p) => s + p.y, 0);
      const sumXY = calPts.reduce((s, p) => s + p.price * p.y, 0);
      const sumXX = calPts.reduce((s, p) => s + p.price * p.price, 0);
      const m = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
      const c = (sumY - m * sumX) / n;
      const sorted = [...calPts].sort((a, b) => a.price - b.price);
      console.log("[drawing] price calibration from geometry", {
        pointCount: n, iframeOffsetY: iframeOffset.y,
        slope: m.toFixed(6), intercept: Math.round(c),
        priceRange: [Math.round(sorted[0].price), Math.round(sorted[n - 1].price)],
      });
      priceToY = (price: number) => Math.max(topClamp, Math.min(botClamp, m * price + c));
    } else {
      const visLow = sp.visiblePriceLow;
      const visHigh = sp.visiblePriceHigh;
      const priceRange = visHigh - visLow;
      console.log("[drawing] price calibration FALLBACK", { visLow, visHigh, rawPtsFound: rawCalibrationPts.length });
      priceToY = (price: number) => {
        const ratio = (price - visLow) / priceRange;
        return Math.max(CT + 12, Math.min(CB - 12, CB - ratio * CH));
      };
    }
  } else {
    // Agent positions take over — priceToY is not used for T1/T2.
    // Set a no-op; anchorPriceToY below will override for zone placement.
    priceToY = (price: number) => {
      const ratio = (price - sp.visiblePriceLow) / (sp.visiblePriceHigh - sp.visiblePriceLow);
      return Math.max(CT + 12, Math.min(CB - 12, CB - ratio * CH));
    };
  }

  // ── 3. Compute T1/T2/zone anchor coordinates ─────────────────────────────
  // Path A: agent reported exact pixel positions in View 6 → use them directly.
  // Path B: no agent positions → derive from price calibration + time estimate.
  // (agentT1Pos / agentT2Pos / hasAgentPositions declared in step 1 above)

  let t1X: number, t1Y: number, t2X: number, t2Y: number;

  if (hasAgentPositions) {
    // Agent saw these exact candles in View 6 — use reported positions directly.
    // xPct/yPct are fractions of the 1440×900 viewport → page.mouse.click coords.
    t1X = agentT1Pos!.xPct * viewport.width;
    t1Y = agentT1Pos!.yPct * viewport.height;
    t2X = agentT2Pos!.xPct * viewport.width;
    t2Y = agentT2Pos!.yPct * viewport.height;
    console.log("[drawing] using agent View-6 pixel positions", {
      t1: { x: Math.round(t1X), y: Math.round(t1Y), price: sp.t1Price },
      t2: { x: Math.round(t2X), y: Math.round(t2Y), price: sp.t2Price },
    });
  } else {
    // Fallback: estimate from price calibration + hardcoded X percentages.
    t1X = sp.t1TimeSec
      ? Math.max(CL + 10, Math.min(CR - 20, CL + CW * 0.85 - (((sp.t3TimeSec ?? sp.t2TimeSec ?? Date.now() / 1000) - sp.t1TimeSec) * (CW * 0.85)) / (130 * sp.candleSeconds)))
      : CL + CW * 0.30;
    t2X = sp.t2TimeSec
      ? Math.max(CL + 10, Math.min(CR - 20, CL + CW * 0.85 - (((sp.t3TimeSec ?? sp.t2TimeSec ?? Date.now() / 1000) - sp.t2TimeSec) * (CW * 0.85)) / (130 * sp.candleSeconds)))
      : CL + CW * 0.58;
    t1Y = priceToY(sp.t1Price);
    t2Y = priceToY(sp.t2Price);
    console.log("[drawing] using calibrated coordinates (no agent positions)", {
      t1: { x: Math.round(t1X), y: Math.round(t1Y), price: sp.t1Price },
      t2: { x: Math.round(t2X), y: Math.round(t2Y), price: sp.t2Price },
    });
  }

  // ── 3.5. Locate anchors with Haiku vision (fallback only) ───────────────────
  // When the main vision agent already reported pixel positions (viewSixPos),
  // skip Haiku — the agent positions are accurate and Haiku Y calibration is
  // unreliable (it returns the same Y for both anchors). At 4H timeframe the
  // chart barely drifts during the 30s API call, so viewSixPos stays valid.
  // Haiku is only attempted when no agent positions are available at all.

  const isLong = sp.direction === "long";
  let haikuFound = false;

  if (!hasAgentPositions) {
    setActionLabel(sessionId, `Locating T1 anchor — price ${sp.t1Price}`);
    const haikuT1 = await locateAnchorWithHaiku(
      page,
      sp.t1Price,
      isLong,
      "T1",
      isLong
        ? `Major structural swing low — the dominant trough. Price ~${sp.t1Price}.`
        : `Major structural swing high — the dominant peak. Price ~${sp.t1Price}.`,
    );
    if (haikuT1) {
      console.log(`[haiku-locate] T1 override: (${Math.round(t1X)},${Math.round(t1Y)}) → (${haikuT1.x},${haikuT1.y})`);
      t1X = haikuT1.x;
      t1Y = haikuT1.y;
    } else {
      console.log("[haiku-locate] T1 not found — keeping initial estimate");
    }

    setActionLabel(sessionId, `Locating T2 anchor — price ${sp.t2Price}`);
    const haikuT2 = await locateAnchorWithHaiku(
      page,
      sp.t2Price,
      isLong,
      "T2",
      isLong
        ? `Higher structural low confirming ascending slope. Price ~${sp.t2Price}.`
        : `Lower structural high confirming descending slope. Price ~${sp.t2Price}.`,
    );
    if (haikuT2) {
      console.log(`[haiku-locate] T2 override: (${Math.round(t2X)},${Math.round(t2Y)}) → (${haikuT2.x},${haikuT2.y})`);
      t2X = haikuT2.x;
      t2Y = haikuT2.y;
    } else {
      console.log("[haiku-locate] T2 not found — keeping initial estimate");
    }

    haikuFound = haikuT1 !== null && haikuT2 !== null;
  } else {
    console.log("[haiku-locate] skipped — using agent viewSixPos directly", {
      t1: { x: Math.round(t1X), y: Math.round(t1Y) },
      t2: { x: Math.round(t2X), y: Math.round(t2Y) },
    });
  }

  // Derive priceToY from actual T1/T2 positions for zone placement.
  // When Haiku or agent positions are available these are real pixel coords.
  const anchorPriceSpan = sp.t2Price - sp.t1Price;
  const anchorYSpan = t2Y - t1Y;
  const anchorPriceToY = (price: number): number => {
    if ((hasAgentPositions || haikuFound) && anchorPriceSpan !== 0) {
      const raw = t1Y + ((price - sp.t1Price) * anchorYSpan) / anchorPriceSpan;
      return Math.max(CT + 12, Math.min(CB - 12, raw));
    }
    return priceToY(price);
  };

  const activeZone = overlay?.invalidationZone ?? {
    low: sp.zoneLow,
    high: sp.zoneHigh,
    note:
      overlay?.structureStatus === "broken"
        ? overlay.invalidationNote ?? "Broken structure region"
        : "Projected interaction zone",
  };
  const zoneTopY = anchorPriceToY(activeZone.high);
  const zoneBottomY = anchorPriceToY(activeZone.low);

  // Zone X: if agent gave us anchor positions, place zone between T2 and the right edge.
  // Otherwise estimate from time.
  const latestSec = sp.t3TimeSec ?? sp.t2TimeSec ?? Date.now() / 1000;
  const pixPerSec = (CW * 0.85) / (130 * sp.candleSeconds);
  const timeToX = (sec: number) =>
    Math.max(CL + 10, Math.min(CR - 20, CL + CW * 0.85 - (latestSec - sec) * pixPerSec));

  const zoneStartX = hasAgentPositions
    ? Math.min(t2X + CW * 0.05, CR - 130)
    : Math.min(timeToX(sp.t2TimeSec ?? latestSec - sp.candleSeconds * 8), timeToX(sp.t3TimeSec ?? latestSec));
  const zoneEndX = hasAgentPositions
    ? Math.min(zoneStartX + CW * 0.12, CR - 20)
    : Math.max(timeToX(sp.t2TimeSec ?? latestSec - sp.candleSeconds * 8), timeToX(sp.t3TimeSec ?? latestSec + sp.candleSeconds * 6));
  const zoneLeftX = Math.min(zoneStartX, zoneEndX);
  const zoneRightX = Math.max(zoneStartX, zoneEndX);

  console.log("[drawing] zone coordinates", {
    topLeft: { x: Math.round(zoneLeftX), y: Math.round(zoneTopY) },
    bottomRight: { x: Math.round(zoneRightX), y: Math.round(zoneBottomY) },
    source: hasAgentPositions ? "anchor-derived" : "calibrated",
  });

  // ── 3. Clear stale drawings from previous sessions ───────────────────────────
  // Right-clicking on empty chart space shows "Remove N drawings" when any exist.
  // Clearing before drawing prevents visual clutter and wrong context menus.
  setActionLabel(sessionId, "Clearing previous drawings");
  try {
    await page.mouse.click(chartCx, chartCy, { button: "right" });
    await page.waitForTimeout(500);
    for (const root of [chartFrame, page]) {
      // Matches "Remove 1 drawing", "Remove 7 drawings", etc.
      const removeBtn = root.locator("text=/Remove \\d+ drawings?/").first();
      const visible = await removeBtn.isVisible().catch(() => false);
      if (visible) {
        await removeBtn.click();
        await page.waitForTimeout(300);
        console.log("[drawing] cleared stale drawings");
        break;
      }
    }
    // Dismiss the context menu if nothing was clicked.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  } catch {
    // non-fatal
  }

  // ── 4. Walk the cursor to T1 and T2 for UX visibility ───────────────────────
  setActionLabel(sessionId, `Regime: ${isLong ? "bullish — ascending support" : "bearish — descending resistance"}`);
  await page.waitForTimeout(700);

  setActionLabel(sessionId, `T1 — first structural ${isLong ? "swing low" : "swing high"} at ${sp.t1Price}`);
  await movePointerWithTelemetry({ sessionId, page, to: { x: t1X, y: t1Y }, steps: 18 });
  await updatePointer(sessionId, page, { x: t1X, y: t1Y, click: true });
  await page.waitForTimeout(600);

  setActionLabel(sessionId, `T2 — ${isLong ? "higher low" : "lower high"} at ${sp.t2Price} — slope confirmed`);
  await movePointerWithTelemetry({ sessionId, page, to: { x: t2X, y: t2Y }, steps: 18 });
  await updatePointer(sessionId, page, { x: t2X, y: t2Y, click: true });
  await page.waitForTimeout(600);

  // ── 5. Draw via Charting Library JS API ──────────────────────────────────────
  // Prefer the JS API (zero mouse automation, instant, extend-right built-in).
  // Works even when T1 is off-screen: agent provides an ISO date that converts
  // directly to a Unix timestamp without needing pixel coordinate interpolation.
  const drawT1Pos = overlay?.t1ViewSixPos;
  const drawT2Pos = overlay?.t2ViewSixPos;
  const t1DateUtcSec = overlay?.t1Date ? Math.round(Date.parse(overlay.t1Date + "T12:00:00Z") / 1000) : undefined;
  const t2DateUtcSec = overlay?.t2Date ? Math.round(Date.parse(overlay.t2Date + "T12:00:00Z") / 1000) : undefined;

  // Can draw via API if we have a time source for both anchors:
  // either viewSixPos.xPct (on-screen) or a date string (off-screen).
  const t1HasTime = drawT1Pos !== undefined || t1DateUtcSec !== undefined;
  const t2HasTime = drawT2Pos !== undefined || t2DateUtcSec !== undefined;

  if (t1HasTime && t2HasTime) {
    setActionLabel(sessionId, "Drawing structure via Charting Library API");
    const apiOk = await drawWithChartApi(
      page,
      sessionId,
      { price: sp.t1Price, xPct: drawT1Pos?.xPct, dateUtcSec: t1DateUtcSec },
      { price: sp.t2Price, xPct: drawT2Pos?.xPct, dateUtcSec: t2DateUtcSec },
      { low: activeZone.low, high: activeZone.high },
    );

    if (apiOk) {
      await saveDrawingCheckpoint(sessionId, page, "06_drawing_complete_api");
      setActionLabel(sessionId, overlay?.structureStatus === "broken"
        ? `Structure mapped — invalidation zone drawn (API)`
        : "Trendline extended + zone drawn via Charting Library API");
      await page.waitForTimeout(800);
      setActionLabel(sessionId, undefined);
      console.log("[drawing] done via Charting Library API", { sessionId });
      return;
    }

    console.log("[drawing] API path failed — falling back to mouse automation");
  } else {
    console.log("[drawing] no viewSixPos — using mouse automation");
  }

  // ── 5b. Mouse-based fallback ─────────────────────────────────────────────────
  setActionLabel(
    sessionId,
    overlay?.structureStatus === "broken"
      ? `Marking invalidation zone — ${activeZone.note}`
      : "Marking projected interaction zone",
  );

  const rectActivation = await activateDrawingTool(
    sessionId, page, chartFrame, "rectangle", chartCx, chartCy,
  );
  console.log("[drawing] rectangle tool activation result:", rectActivation);

  await movePointerWithTelemetry({ sessionId, page, to: { x: zoneLeftX, y: zoneTopY }, steps: 10 });
  await page.waitForTimeout(120);
  await updatePointer(sessionId, page, { x: zoneLeftX, y: zoneTopY, click: true });
  await page.mouse.click(zoneLeftX, zoneTopY);
  await page.waitForTimeout(280);
  await saveDrawingCheckpoint(sessionId, page, "02_rect_anchor1");
  await dismissDerivTooltips(page, chartFrame);

  await movePointerWithTelemetry({ sessionId, page, to: { x: zoneRightX, y: zoneBottomY }, steps: 18 });
  await page.waitForTimeout(120);
  await updatePointer(sessionId, page, { x: zoneRightX, y: zoneBottomY, click: true });
  await page.mouse.click(zoneRightX, zoneBottomY);
  await page.waitForTimeout(420);
  await saveDrawingCheckpoint(sessionId, page, "03_rect_anchor2");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  const trendlineActivation = await activateDrawingTool(
    sessionId, page, chartFrame, "trendline", chartCx, chartCy,
  );
  console.log("[drawing] trendline tool activation result:", trendlineActivation);

  setActionLabel(sessionId, "Placing T1 anchor on chart");
  await movePointerWithTelemetry({ sessionId, page, to: { x: t1X, y: t1Y }, steps: 12 });
  await page.waitForTimeout(150);
  await updatePointer(sessionId, page, { x: t1X, y: t1Y, click: true });
  await page.mouse.click(t1X, t1Y);
  await page.waitForTimeout(400);
  await saveDrawingCheckpoint(sessionId, page, "04_trendline_anchor1");
  await dismissDerivTooltips(page, chartFrame);

  setActionLabel(sessionId, "Drawing to T2 — locking trendline slope");
  await movePointerWithTelemetry({ sessionId, page, to: { x: t2X, y: t2Y }, steps: 22 });
  await page.waitForTimeout(150);
  await updatePointer(sessionId, page, { x: t2X, y: t2Y, click: true });
  await page.mouse.click(t2X, t2Y);
  await page.waitForTimeout(600);
  await saveDrawingCheckpoint(sessionId, page, "05_trendline_anchor2");

  // Deselect and finish
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await saveDrawingCheckpoint(sessionId, page, "06_drawing_complete");

  console.log("[drawing] done via mouse fallback", {
    sessionId,
    rectActivation,
    trendlineActivation,
    checkpointsDir: path.join(SCREENSHOT_ROOT, "drawing-debug"),
  });

  setActionLabel(
    sessionId,
    overlay?.structureStatus === "broken"
      ? `Structure mapped — trendline broken (${overlay.invalidationNote ?? activeZone.note})`
      : "Trendline drawn — T1 → T2 locked on chart",
  );
  await page.waitForTimeout(800);
  setActionLabel(sessionId, undefined);
}

export async function startControlledBrowserSession(args: {
  sessionId: string;
  agentSlug: string;
  agentMarketSymbol: string;
  marketSymbol: string;
  timeframe: string;
  targetUrl: string;
  swingPoints?: SwingPointsForBrowser;
}) {
  const existing = runtimeSessions.get(args.sessionId);
  if (existing) {
    console.log("[browser-session-runtime] reusing existing runtime", {
      sessionId: args.sessionId,
    });
    return {
      ok: true,
      screenshotPath: existing.screenshotPath,
      reused: true,
    };
  }

  console.log("[browser-session-runtime] boot requested", {
    sessionId: args.sessionId,
    agentSlug: args.agentSlug,
    agentMarketSymbol: args.agentMarketSymbol,
    marketSymbol: args.marketSymbol,
    timeframe: args.timeframe,
    targetUrl: args.targetUrl,
    hasSwingPoints: Boolean(args.swingPoints),
  });

  await ensureScreenshotDir();
  const screenshotPath = screenshotPathFor(args.sessionId);
  console.log("[browser-session-runtime] launching chromium", {
    sessionId: args.sessionId,
  });
  const browser = await launchBrowser();
  console.log("[browser-session-runtime] chromium launched", {
    sessionId: args.sessionId,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });

  // Intercept the TradingView Charting Library widget constructor so we can
  // draw trendlines and zones via the JS API instead of mouse automation.
  // The script runs before any page script. It wraps window.TradingView in a
  // Proxy so when charting_library.js assigns TradingView.widget we wrap that
  // constructor too, capturing every new widget instance as window.__gildoreWidget.
  await page.addInitScript(`
    (function () {
      let _tv;
      Object.defineProperty(window, 'TradingView', {
        configurable: true,
        enumerable: true,
        get: function () { return _tv; },
        set: function (v) {
          if (v && typeof v === 'object') {
            _tv = new Proxy(v, {
              set: function (target, prop, value) {
                if (prop === 'widget' && typeof value === 'function') {
                  var Orig = value;
                  function GildoreWidget() {
                    var inst = new (Function.prototype.bind.apply(Orig, [null].concat(Array.prototype.slice.call(arguments))))();
                    window.__gildoreWidget = inst;
                    console.log('[gildore] TradingView widget captured');
                    return inst;
                  }
                  GildoreWidget.prototype = Orig.prototype;
                  Object.setPrototypeOf(GildoreWidget, Orig);
                  target[prop] = GildoreWidget;
                  return true;
                }
                target[prop] = value;
                return true;
              }
            });
          } else {
            _tv = v;
          }
        }
      });
    })();
  `);
  console.log("[browser-session-runtime] new page created", {
    sessionId: args.sessionId,
  });

  runtimeSessions.set(args.sessionId, {
    browser,
    page,
    screenshotPath,
    pointerPulseId: 0,
    listeners: new Set(),
  });
  await startLiveCaptureLoop(args.sessionId);

  const steps = buildSteps(args.marketSymbol, args.timeframe);

  try {
    console.log("[browser-session-runtime] step 1 loading chart", {
      sessionId: args.sessionId,
      targetUrl: args.targetUrl,
    });
    await writeStepState({
      sessionId: args.sessionId,
      steps,
      currentIndex: 1,
      currentStatus: "loading_chart",
    });

    await page.goto(args.targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(3000);
    await capture(args.sessionId);
    console.log("[browser-session-runtime] chart loaded", {
      sessionId: args.sessionId,
    });

    console.log("[browser-session-runtime] step 2 switching symbol", {
      sessionId: args.sessionId,
      marketSymbol: args.marketSymbol,
    });
    await writeStepState({
      sessionId: args.sessionId,
      steps,
      currentIndex: 2,
      currentStatus: "switching_symbol",
    });
    await switchDerivSymbol(args.sessionId, page, args.marketSymbol);
    await capture(args.sessionId);
    console.log("[browser-session-runtime] symbol switched", {
      sessionId: args.sessionId,
      marketSymbol: args.marketSymbol,
    });

    console.log("[browser-session-runtime] step 3 switching timeframe", {
      sessionId: args.sessionId,
      timeframe: args.timeframe,
    });
    await writeStepState({
      sessionId: args.sessionId,
      steps,
      currentIndex: 3,
      currentStatus: "switching_timeframe",
    });
    await switchDerivTimeframe(args.sessionId, page, args.timeframe);
    await capture(args.sessionId);
    console.log("[browser-session-runtime] timeframe switched", {
      sessionId: args.sessionId,
      timeframe: args.timeframe,
    });

    console.log("[browser-session-runtime] panning chart for review", {
      sessionId: args.sessionId,
    });
    await panChartForReview(args.sessionId, page);
    await capture(args.sessionId);
    console.log("[browser-session-runtime] chart positioned for review", {
      sessionId: args.sessionId,
    });

    // Always capture the 6-shot sequence and run vision analysis.
    // swingPoints is optional context (only valid when the browser symbol matches the agent market).
    setActionLabel(args.sessionId, "Capturing chart context for vision analysis");
    console.log("[browser-session-runtime] capturing strategy screenshots", {
      sessionId: args.sessionId,
    });
    const screenshots = await captureStrategyScreenshots(args.sessionId, page, args.timeframe);
    await capture(args.sessionId);
    console.log("[browser-session-runtime] strategy screenshots captured", {
      sessionId: args.sessionId,
      screenshotCount: screenshots.length,
    });

    setActionLabel(args.sessionId, "Analysing structure with vision agent");
    try {
      console.log("[browser-session-runtime] starting vision analysis", {
        sessionId: args.sessionId,
      });
      const decision = await analyzeChartWithVision(screenshots, args.swingPoints);
      console.log("[vision-agent] parsed decision:\n", JSON.stringify(decision, null, 2));
      const runtime = runtimeSessions.get(args.sessionId);
      if (runtime) runtime.visionDecision = decision;
      await capture(args.sessionId);
      console.log("[browser-session-runtime] vision analysis completed", {
        sessionId: args.sessionId,
        verdict: decision.verdict,
        regime: decision.regime,
        direction: decision.direction,
        confidence: decision.confidence,
      });

      // Persist to Convex — gated internally so only writes on significant changes
      try {
        const convex = getConvexClient();
        await convex.mutation(api.arena.persistVisionDecision, {
          agentSlug: args.agentSlug,
          marketSymbol: args.agentMarketSymbol,
          regime: decision.regime,
          verdict: decision.verdict,
          direction: decision.direction,
          structureStatus: decision.structureStatus,
          confidence: decision.confidence,
          correctedT1: decision.correctedT1 ?? undefined,
          correctedT2: decision.correctedT2 ?? undefined,
          correctedZone: decision.correctedZone ?? undefined,
          invalidationZone: decision.invalidationZone ?? undefined,
          invalidationNote: decision.invalidationNote ?? undefined,
          rationale: decision.rationale,
          issues: decision.issues,
        });
        console.log("[browser-session-runtime] vision decision persisted", {
          sessionId: args.sessionId,
        });
      } catch (persistErr) {
        console.error("[vision-agent] persist failed:", persistErr);
      }

      // Build draw points — prefer AI corrections, fall back to deterministic if available.
      // Structure mapping is independent from trade verdict: even rejects should be drawable.
      const base = args.swingPoints;
      const t1Price = decision.correctedT1?.price ?? base?.t1Price;
      const t2Price = decision.correctedT2?.price ?? base?.t2Price;
      const projectedPrice =
        decision.correctedZone?.projectedPrice ?? base?.projectedPrice;
      const zoneLow =
        decision.correctedZone?.low ??
        decision.invalidationZone?.low ??
        base?.zoneLow;
      const zoneHigh =
        decision.correctedZone?.high ??
        decision.invalidationZone?.high ??
        base?.zoneHigh;
      const direction =
        decision.direction !== "none"
          ? decision.direction
          : base?.direction ??
            (t2Price !== undefined && t1Price !== undefined
              ? t2Price > t1Price
                ? "long"
                : "short"
              : undefined);

      if (
        t1Price !== undefined &&
        t2Price !== undefined &&
        projectedPrice !== undefined &&
        zoneLow !== undefined &&
        zoneHigh !== undefined &&
        direction !== undefined
      ) {
        const allPrices = [
          t1Price,
          t2Price,
          projectedPrice,
          zoneLow,
          zoneHigh,
        ];
        const rawLow = Math.min(...allPrices);
        const rawHigh = Math.max(...allPrices);
        const padding = (rawHigh - rawLow) * 0.2;

        const drawPoints: SwingPointsForBrowser = {
          t1Price,
          t1TimeSec: base?.t1TimeSec,
          t2Price,
          t2TimeSec: base?.t2TimeSec,
          projectedPrice,
          t3TimeSec: base?.t3TimeSec,
          zoneLow,
          zoneHigh,
          direction,
          visiblePriceLow: rawLow - padding,
          visiblePriceHigh: rawHigh + padding,
          candleSeconds: base?.candleSeconds ?? 14400,
        };

        console.log("[browser-session-runtime] drawing mapped structure", {
          sessionId: args.sessionId,
          direction: drawPoints.direction,
          verdict: decision.verdict,
          structureStatus: decision.structureStatus,
        });
        await identifySwingPointsOnChart(args.sessionId, page, drawPoints, {
          structureStatus: decision.structureStatus,
          verdict: decision.verdict,
          invalidationZone: decision.invalidationZone,
          invalidationNote: decision.invalidationNote,
          t1ViewSixPos: decision.correctedT1?.viewSixPos,
          t2ViewSixPos: decision.correctedT2?.viewSixPos,
          t1Date: decision.correctedT1?.date,
          t2Date: decision.correctedT2?.date,
        });
        await capture(args.sessionId);
        console.log("[browser-session-runtime] mapped structure drawn", {
          sessionId: args.sessionId,
        });
      } else {
        console.log("[browser-session-runtime] skipped structure drawing", {
          sessionId: args.sessionId,
          hasT1: t1Price !== undefined,
          hasT2: t2Price !== undefined,
          hasProjectedPrice: projectedPrice !== undefined,
          hasZoneLow: zoneLow !== undefined,
          hasZoneHigh: zoneHigh !== undefined,
          direction,
          verdict: decision.verdict,
          structureStatus: decision.structureStatus,
        });
        setActionLabel(
          args.sessionId,
          `Vision: ${decision.rationale.slice(0, 90)}`,
        );
        await page.waitForTimeout(1500);
        setActionLabel(args.sessionId, undefined);
      }
    } catch (err) {
      console.error("[vision-agent] error:", err);
      setActionLabel(args.sessionId, "Vision analysis failed — check server logs");
      await page.waitForTimeout(1000);
      // Fall back to deterministic drawing if we have swing points
      if (args.swingPoints) {
        console.log("[browser-session-runtime] falling back to deterministic drawing", {
          sessionId: args.sessionId,
        });
        await identifySwingPointsOnChart(args.sessionId, page, args.swingPoints);
        await capture(args.sessionId);
        console.log("[browser-session-runtime] deterministic fallback drawn", {
          sessionId: args.sessionId,
        });
      }
      setActionLabel(args.sessionId, undefined);
    }

    console.log("[browser-session-runtime] marking session ready", {
      sessionId: args.sessionId,
    });
    await writeStepState({
      sessionId: args.sessionId,
      steps,
      currentIndex: 4,
      currentStatus: "ready",
    });
    await capture(args.sessionId);
    console.log("[browser-session-runtime] session ready", {
      sessionId: args.sessionId,
      screenshotPath,
    });
    return {
      ok: true,
      screenshotPath,
      reused: false,
    };
  } catch (error) {
    console.error("[browser-session-runtime] startup failed", {
      sessionId: args.sessionId,
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name,
      } : error,
    });
    await writeStepState({
      sessionId: args.sessionId,
      steps,
      currentIndex: Math.min(steps.length, 3),
      currentStatus: "failed",
      error: error instanceof Error ? error.message : "browser_session_failed",
    });

    try {
      await capture(args.sessionId);
    } catch {}

    throw error;
  }
}

export async function readControlledBrowserScreenshot(sessionId: string) {
  const filePath = screenshotPathFor(sessionId);
  return await fs.readFile(filePath);
}

export type BrowserInteractEvent =
  | { type: "mousedown"; x: number; y: number }
  | { type: "mousemove"; x: number; y: number }
  | { type: "mouseup"; x: number; y: number }
  | { type: "wheel"; x: number; y: number; deltaX: number; deltaY: number };

export async function interactWithBrowserSession(
  sessionId: string,
  event: BrowserInteractEvent,
): Promise<void> {
  const runtime = runtimeSessions.get(sessionId);
  if (!runtime) throw new Error("browser_session_runtime_unavailable");
  const { page } = runtime;

  switch (event.type) {
    case "mousedown":
      await page.mouse.move(event.x, event.y);
      await page.mouse.down();
      break;
    case "mousemove":
      await page.mouse.move(event.x, event.y);
      break;
    case "mouseup":
      await page.mouse.move(event.x, event.y);
      await page.mouse.up();
      break;
    case "wheel":
      await page.mouse.move(event.x, event.y);
      await page.mouse.wheel(event.deltaX, event.deltaY);
      break;
  }
}

export function subscribeControlledBrowserStream(
  sessionId: string,
  onFrame: (payload: BrowserStreamPayload) => void,
) {
  const runtime = runtimeSessions.get(sessionId);
  if (!runtime) {
    throw new Error("browser_session_runtime_unavailable");
  }

  runtime.listeners.add(onFrame);
  if (runtime.latestPayload) {
    onFrame(runtime.latestPayload);
  }

  return () => {
    runtime.listeners.delete(onFrame);
  };
}
