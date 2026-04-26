import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { Buffer } from "node:buffer";
import { chromium, type Browser, type Frame, type Locator, type Page } from "playwright";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

type BrowserStepStatus = "queued" | "running" | "completed" | "failed";

export type BrowserStreamPayload = {
  frame: string;
  mimeType: "image/png";
  timestamp: number;
  pointer?: {
    x: number;
    y: number;
    viewportWidth: number;
    viewportHeight: number;
    pulseId: number;
    clickAt?: number;
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
  listeners: Set<(payload: BrowserStreamPayload) => void>;
};

const runtimeSessions = new Map<string, SessionRuntime>();
const SCREENSHOT_ROOT = "/tmp/gildore-browser-sessions";

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
  args: { x: number; y: number; click?: boolean },
) {
  const runtime = runtimeSessions.get(sessionId);
  if (!runtime) return;

  runtime.pointerPulseId += args.click ? 1 : 0;
  runtime.pointer = {
    x: args.x,
    y: args.y,
    pulseId: runtime.pointerPulseId,
    clickAt: args.click ? Date.now() : runtime.pointer?.clickAt,
    viewportWidth: page.viewportSize()?.width ?? 1440,
    viewportHeight: page.viewportSize()?.height ?? 900,
  };
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

  await updatePointer(sessionId, page, { x, y });
  await page.mouse.move(x, y, { steps: 8 });
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

  await clickLocatorWithTelemetry(
    sessionId,
    page,
    chartFrame.getByText(/^Derived$/).first(),
  ).catch(() => {});

  await page.waitForTimeout(400);

  const searchInput = chartFrame.locator('input[placeholder="Search"]').first();
  const filledSearch = await searchInput
    .fill(marketSymbol)
    .then(() => true)
    .catch(() => false);

  if (!filledSearch) {
    throw new Error("Could not find the Deriv symbol search input.");
  }

  await page.waitForTimeout(1200);

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

  const frameBody = chartFrame.locator("body");
  const bodyBox = await frameBody.boundingBox().catch(() => null);
  if (bodyBox) {
    const x = bodyBox.x + bodyBox.width * 0.5;
    const y = bodyBox.y + bodyBox.height * 0.2;
    await updatePointer(sessionId, page, { x, y });
    await page.mouse.move(x, y, { steps: 6 });
    await updatePointer(sessionId, page, { x, y, click: true });
  }
  await frameBody.click();
  await chartFrame.locator("body").press(",");
  await page.waitForTimeout(700);

  const intervalInput = chartFrame.locator("input").first();
  const filled = await intervalInput
    .fill(resolution)
    .then(() => true)
    .catch(() => false);

  if (!filled) {
    throw new Error("Could not access the Deriv interval input.");
  }

  await intervalInput.press("Enter");
  await page.waitForTimeout(1400);
}

export async function startControlledBrowserSession(args: {
  sessionId: string;
  marketSymbol: string;
  timeframe: string;
  targetUrl: string;
}) {
  const existing = runtimeSessions.get(args.sessionId);
  if (existing) {
    return {
      ok: true,
      screenshotPath: existing.screenshotPath,
      reused: true,
    };
  }

  await ensureScreenshotDir();
  const screenshotPath = screenshotPathFor(args.sessionId);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
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

    await writeStepState({
      sessionId: args.sessionId,
      steps,
      currentIndex: 2,
      currentStatus: "switching_symbol",
    });
    await switchDerivSymbol(args.sessionId, page, args.marketSymbol);
    await capture(args.sessionId);

    await writeStepState({
      sessionId: args.sessionId,
      steps,
      currentIndex: 3,
      currentStatus: "switching_timeframe",
    });
    await switchDerivTimeframe(args.sessionId, page, args.timeframe);
    await capture(args.sessionId);

    await writeStepState({
      sessionId: args.sessionId,
      steps,
      currentIndex: 4,
      currentStatus: "ready",
    });
    await capture(args.sessionId);
    return {
      ok: true,
      screenshotPath,
      reused: false,
    };
  } catch (error) {
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
