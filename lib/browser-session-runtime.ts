import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { Buffer } from "node:buffer";
import bundledChromium from "@sparticuz/chromium";
import { chromium, type Browser, type Frame, type Locator, type Page } from "playwright-core";
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
    "24h": "1440",
  };
  const resolution = resolutionMap[timeframe];

  if (!resolution) {
    throw new Error(`Unsupported Deriv timeframe "${timeframe}".`);
  }

  setActionLabel(sessionId, "Opening interval selector");
  const frameBody = chartFrame.locator("body");
  const bodyBox = await frameBody.boundingBox().catch(() => null);
  if (bodyBox) {
    const x = bodyBox.x + bodyBox.width * 0.5;
    const y = bodyBox.y + bodyBox.height * 0.2;
    await movePointerWithTelemetry({
      sessionId,
      page,
      to: { x, y },
      steps: 6,
    });
    await updatePointer(sessionId, page, { x, y, click: true });
  }
  await frameBody.click();
  await chartFrame.locator("body").press(",");
  await page.waitForTimeout(700);

  setActionLabel(sessionId, `Setting ${timeframe} interval`);
  const intervalInput = chartFrame.locator("input").first();
  const filled = await intervalInput
    .fill(resolution)
    .then(() => true)
    .catch(() => false);

  if (!filled) {
    throw new Error("Could not access the Deriv interval input.");
  }

  setActionLabel(sessionId, "Confirming timeframe");
  await intervalInput.press("Enter");
  await page.waitForTimeout(1400);
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

async function dismissDerivTooltips(page: Page) {
  // Deriv shows two modal-style tooltips on first interaction.
  // Dismiss them so they don't appear in strategy screenshots.
  const dismissSelectors = [
    'button:has-text("Got it!")',
    'button:has-text("Got it")',
    '[aria-label="Close"]',
    'button.close',
    '.tooltip__close',
    '.modal__close',
  ];
  for (const selector of dismissSelectors) {
    const buttons = page.locator(selector);
    const count = await buttons.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      await buttons.nth(i).click({ force: true }).catch(() => {});
    }
  }
  // Also dismiss via keyboard in case any dialog is focused
  await page.keyboard.press("Escape").catch(() => {});
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
): Promise<Buffer[]> {
  const viewport = page.viewportSize() ?? { width: 1440, height: 900 };
  const chartCx = viewport.width * 0.44;
  const chartCy = viewport.height * 0.47;
  const screenshots: Buffer[] = [];

  await dismissDerivTooltips(page);

  async function snap(label: string): Promise<void> {
    await dismissDerivTooltips(page);
    await autoScaleYAxis(page);
    setActionLabel(sessionId, label);
    await page.waitForTimeout(700);
    screenshots.push(await captureToBuffer(page));
  }

  // ── Zoom out so each viewport shows ~300 candles ─────────────────────────────
  await movePointerWithTelemetry({ sessionId, page, to: { x: chartCx, y: chartCy }, steps: 4 });
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(600);

  // ── Pan deep into history (3 full viewport widths = ~600+ candles) ───────────
  // Each 900px drag at this zoom level ≈ 200 candles of additional history.
  setActionLabel(sessionId, "Panning into history — viewport 1");
  await dragPointerWithTelemetry({
    sessionId, page,
    from: { x: chartCx, y: chartCy },
    to: { x: chartCx + 900, y: chartCy },
    steps: 45,
  });
  await snap("Screenshot 1/6 — oldest visible structure, full regime backdrop");

  // ── Second viewport of history ───────────────────────────────────────────────
  setActionLabel(sessionId, "Panning into history — viewport 2");
  await dragPointerWithTelemetry({
    sessionId, page,
    from: { x: chartCx, y: chartCy },
    to: { x: chartCx + 900, y: chartCy },
    steps: 45,
  });
  await snap("Screenshot 2/6 — second historical segment, swing structure");

  // ── Third viewport of history ────────────────────────────────────────────────
  setActionLabel(sessionId, "Panning into history — viewport 3");
  await dragPointerWithTelemetry({
    sessionId, page,
    from: { x: chartCx, y: chartCy },
    to: { x: chartCx + 900, y: chartCy },
    steps: 45,
  });
  await snap("Screenshot 3/6 — third historical segment, T1/T2 anchor region");

  // ── March forward — post-T2 behaviour ───────────────────────────────────────
  // Pan left (toward current) two viewport widths
  setActionLabel(sessionId, "Advancing to T2 and beyond");
  await dragPointerWithTelemetry({
    sessionId, page,
    from: { x: chartCx, y: chartCy },
    to: { x: chartCx - 1600, y: chartCy },
    steps: 70,
  });
  await snap("Screenshot 4/6 — post-T2 behaviour, line interaction history");

  // ── T3 / current price area — zoom in for detail ─────────────────────────────
  setActionLabel(sessionId, "Zooming into T3 zone");
  await dragPointerWithTelemetry({
    sessionId, page,
    from: { x: chartCx, y: chartCy },
    to: { x: chartCx - 500, y: chartCy },
    steps: 25,
  });
  await page.mouse.wheel(0, -350);
  await page.waitForTimeout(400);
  await snap("Screenshot 5/6 — T3 zone close-up, current candle detail");

  // ── Final settled view — zoom out slightly for full trendline ─────────────────
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(400);
  await snap("Screenshot 6/6 — settled view, full trendline visible");

  return screenshots;
}

async function identifySwingPointsOnChart(
  sessionId: string,
  page: Page,
  sp: SwingPointsForBrowser,
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

  // ── 1. Reset to a clean settled view ────────────────────────────────────────
  // Escape any active tool, zoom in to a reasonable level, auto-scale price axis
  setActionLabel(sessionId, "Settling chart for structure marking");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  // Zoom in from the post-screenshot zoomed-out state: spin wheel inward
  await movePointerWithTelemetry({ sessionId, page, to: { x: chartCx, y: chartCy }, steps: 6 });
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(400);
  await autoScaleYAxis(page);
  await page.waitForTimeout(400);

  // ── 2. Build coordinate maps from the now-visible price range ───────────────
  // Read the current high/low prices from the chart's price axis via DOM
  // to calibrate Y correctly for this exact zoom state.
  const chartFrame = getChartFrame(page);
  const axisPrices = await chartFrame.evaluate(() => {
    // TradingView renders price labels as text nodes on the right price axis
    const labels = Array.from(
      document.querySelectorAll<HTMLElement>(".price-axis__label, [class*='priceLabel'], [class*='price-label']"),
    )
      .map((el) => parseFloat(el.textContent?.replace(/,/g, "") ?? ""))
      .filter((n) => !isNaN(n));
    return { min: Math.min(...labels), max: Math.max(...labels) };
  }).catch(() => ({ min: sp.visiblePriceLow, max: sp.visiblePriceHigh }));

  const visLow = isFinite(axisPrices.min) && axisPrices.min > 0 ? axisPrices.min : sp.visiblePriceLow;
  const visHigh = isFinite(axisPrices.max) && axisPrices.max > 0 ? axisPrices.max : sp.visiblePriceHigh;
  const priceRange = visHigh - visLow;

  function priceToY(price: number): number {
    const ratio = (price - visLow) / priceRange;
    return Math.max(CT + 12, Math.min(CB - 12, CB - ratio * CH));
  }

  // X: after the reset zoom, ~130 candles fit. Latest candle is at ~85% from left.
  const latestSec = sp.t3TimeSec ?? sp.t2TimeSec ?? (Date.now() / 1000);
  const pixPerSec = (CW * 0.85) / (130 * sp.candleSeconds);

  function timeToX(sec: number): number {
    const offset = (latestSec - sec) * pixPerSec;
    return Math.max(CL + 10, Math.min(CR - 20, CL + CW * 0.85 - offset));
  }

  const t1X = sp.t1TimeSec ? timeToX(sp.t1TimeSec) : CL + CW * 0.30;
  const t2X = sp.t2TimeSec ? timeToX(sp.t2TimeSec) : CL + CW * 0.58;
  const t1Y = priceToY(sp.t1Price);
  const t2Y = priceToY(sp.t2Price);

  const isLong = sp.direction === "long";

  // ── 3. Walk the cursor to T1 and T2 so the user can see the reasoning ───────
  setActionLabel(sessionId, `Regime: ${isLong ? "bullish — ascending support" : "bearish — descending resistance"}`);
  await page.waitForTimeout(700);

  setActionLabel(sessionId, `T1 — first structural ${isLong ? "swing low" : "swing high"} at ${sp.t1Price}`);
  await movePointerWithTelemetry({ sessionId, page, to: { x: t1X, y: t1Y }, steps: 18 });
  await updatePointer(sessionId, page, { x: t1X, y: t1Y, click: true });
  await page.waitForTimeout(800);

  setActionLabel(sessionId, `T2 — ${isLong ? "higher low" : "lower high"} at ${sp.t2Price} — slope confirmed`);
  await movePointerWithTelemetry({ sessionId, page, to: { x: t2X, y: t2Y }, steps: 18 });
  await updatePointer(sessionId, page, { x: t2X, y: t2Y, click: true });
  await page.waitForTimeout(800);

  // ── 4. Activate the Trend Line tool and draw T1 → T2 ────────────────────────
  setActionLabel(sessionId, "Activating trend line tool (Alt+T)");
  // First click the chart body to make sure it has keyboard focus
  await page.mouse.click(chartCx, chartCy);
  await page.waitForTimeout(200);
  await page.keyboard.press("Alt+t");
  await page.waitForTimeout(500);
  await dismissDerivTooltips(page);

  setActionLabel(sessionId, "Placing T1 anchor on chart");
  await movePointerWithTelemetry({ sessionId, page, to: { x: t1X, y: t1Y }, steps: 12 });
  await page.waitForTimeout(150);
  await updatePointer(sessionId, page, { x: t1X, y: t1Y, click: true });
  await page.mouse.click(t1X, t1Y);
  await page.waitForTimeout(400);

  setActionLabel(sessionId, "Drawing to T2 — locking trendline slope");
  await movePointerWithTelemetry({ sessionId, page, to: { x: t2X, y: t2Y }, steps: 22 });
  await page.waitForTimeout(150);
  await updatePointer(sessionId, page, { x: t2X, y: t2Y, click: true });
  await page.mouse.click(t2X, t2Y);
  await page.waitForTimeout(500);

  // Deselect the drawing tool
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  setActionLabel(sessionId, "Trendline drawn — T1 → T2 locked on chart");
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
    const screenshots = await captureStrategyScreenshots(args.sessionId, page);
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
          confidence: decision.confidence,
          correctedT1: decision.correctedT1 ?? undefined,
          correctedT2: decision.correctedT2 ?? undefined,
          correctedZone: decision.correctedZone ?? undefined,
          rationale: decision.rationale,
          issues: decision.issues,
        });
        console.log("[browser-session-runtime] vision decision persisted", {
          sessionId: args.sessionId,
        });
      } catch (persistErr) {
        console.error("[vision-agent] persist failed:", persistErr);
      }

      if (decision.verdict !== "reject" && decision.verdict !== "invalid") {
        // Build draw points — prefer AI corrections, fall back to deterministic if available
        const base = args.swingPoints;
        const t1Price = decision.correctedT1?.price ?? base?.t1Price;
        const t2Price = decision.correctedT2?.price ?? base?.t2Price;
        const projectedPrice = decision.correctedZone?.projectedPrice ?? base?.projectedPrice;
        const zoneLow = decision.correctedZone?.low ?? base?.zoneLow;
        const zoneHigh = decision.correctedZone?.high ?? base?.zoneHigh;
        const direction = decision.direction !== "none" ? decision.direction : (base?.direction ?? "long");

        if (t1Price !== undefined && t2Price !== undefined && projectedPrice !== undefined && zoneLow !== undefined && zoneHigh !== undefined) {
          // Compute visible price range from the actual draw prices
          const allPrices = [t1Price, t2Price, projectedPrice, zoneLow, zoneHigh];
          const rawLow = Math.min(...allPrices);
          const rawHigh = Math.max(...allPrices);
          const padding = (rawHigh - rawLow) * 0.20;

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

          console.log("[browser-session-runtime] drawing corrected structure", {
            sessionId: args.sessionId,
            direction: drawPoints.direction,
          });
          await identifySwingPointsOnChart(args.sessionId, page, drawPoints);
          await capture(args.sessionId);
          console.log("[browser-session-runtime] corrected structure drawn", {
            sessionId: args.sessionId,
          });
        }
      } else {
        setActionLabel(args.sessionId, `Vision: ${decision.rationale.slice(0, 90)}`);
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
