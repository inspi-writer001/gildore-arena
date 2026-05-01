import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { Buffer } from "node:buffer";
import bundledChromium from "@sparticuz/chromium";
import { chromium, type Browser, type Frame, type Locator, type Page, type Response } from "playwright-core";
import Anthropic from "@anthropic-ai/sdk";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import {
  analyzeChartWithVision,
  verifyChartDrawing,
  confirmStructureWithSonnet,
  verifyFibonacciDrawing,
  estimateFibonacciPlacementError,
  type ChartVisionDecision,
} from "./chart-vision-analysis";

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

function isDerivChartProbeUrl(url: string) {
  return (
    url.includes("charts.deriv.com") ||
    url.includes("deriv.com") ||
    url.includes("tradingview") ||
    url.includes("charting_library") ||
    url.includes("tv-widget")
  );
}

function isLikelyChartDataUrl(url: string) {
  const normalizedUrl = url.toLowerCase();
  return (
    normalizedUrl.includes("history") ||
    normalizedUrl.includes("bar") ||
    normalizedUrl.includes("candle") ||
    normalizedUrl.includes("tick") ||
    normalizedUrl.includes("ohlc") ||
    normalizedUrl.includes("timescale") ||
    normalizedUrl.includes("resolve") ||
    normalizedUrl.includes("symbol") ||
    normalizedUrl.includes("quote") ||
    normalizedUrl.includes("feed") ||
    normalizedUrl.includes("datafeed")
  );
}

function summarizeJsonShape(value: unknown, depth = 0): unknown {
  if (value === null) return null;
  if (depth >= 2) {
    if (Array.isArray(value)) {
      return { type: "array", length: value.length };
    }
    if (typeof value === "object") {
      return { type: "object", keys: Object.keys(value as Record<string, unknown>).slice(0, 8) };
    }
    return typeof value;
  }

  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      sample:
        value.length > 0 ? summarizeJsonShape(value[0], depth + 1) : "empty",
    };
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 12);
    return Object.fromEntries(
      entries.map(([key, nested]) => [key, summarizeJsonShape(nested, depth + 1)]),
    );
  }

  return typeof value;
}

function summarizeTextShape(text: string) {
  return text
    .slice(0, 260)
    .replace(/\s+/g, " ")
    .trim();
}

async function logDerivChartResponseProbe(sessionId: string, response: Response) {
  const url = response.url();
  if (!isDerivChartProbeUrl(url)) {
    return;
  }

  const contentType = response.headers()["content-type"] ?? "unknown";
  console.log("[fib-probe][response-url]", {
    sessionId,
    status: response.status(),
    resourceType: response.request().resourceType(),
    contentType,
    url,
  });

  if (!response.ok() || !isLikelyChartDataUrl(url)) {
    return;
  }

  const contentLengthHeader = response.headers()["content-length"];
  const contentLength = contentLengthHeader ? Number(contentLengthHeader) : null;
  if (contentLength !== null && Number.isFinite(contentLength) && contentLength > 250_000) {
    console.log("[fib-probe][payload-shape]", {
      sessionId,
      url,
      skipped: "content-too-large",
      contentLength,
    });
    return;
  }

  try {
    const bodyText = await response.text();
    if (!bodyText) {
      console.log("[fib-probe][payload-shape]", {
        sessionId,
        url,
        shape: "empty-body",
      });
      return;
    }

    try {
      const parsed = JSON.parse(bodyText) as unknown;
      console.log("[fib-probe][payload-shape]", {
        sessionId,
        url,
        shape: summarizeJsonShape(parsed),
      });
      return;
    } catch {
      console.log("[fib-probe][payload-shape]", {
        sessionId,
        url,
        shape: summarizeTextShape(bodyText),
      });
    }
  } catch (error) {
    console.log("[fib-probe][payload-shape]", {
      sessionId,
      url,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function attachFibonacciBrowserApiProbe(page: Page) {
  void page.addInitScript(`
    (() => {
      const probeVerbose = window.__fibProbeVerbose === true;
      const ensureDerivHistoryStore = () => {
        const root = window;
        if (!root.__fibProbeDerivHistory) {
          root.__fibProbeDerivHistory = {};
        }
        return root.__fibProbeDerivHistory;
      };

      const shouldLogUrl = (url) => {
        if (typeof url !== "string") return false;
        const value = url.toLowerCase();
        return value.includes("history")
          || value.includes("bar")
          || value.includes("candle")
          || value.includes("tick")
          || value.includes("ohlc")
          || value.includes("resolve")
          || value.includes("symbol")
          || value.includes("quote")
          || value.includes("feed")
          || value.includes("datafeed")
          || value.includes("frontend.derivws.com");
      };

      const shouldLogMessage = (payload) => {
        if (typeof payload !== "string") return false;
        const value = payload.toLowerCase();
        return value.includes("history")
          || value.includes("candles")
          || value.includes("ohlc")
          || value.includes("tick")
          || value.includes("granularity")
          || value.includes("symbol")
          || value.includes("frxxauusd")
          || value.includes("frxxagusd")
          || value.includes("frxeurusd")
          || value.includes("frxgbpusd");
      };

      const log = (kind, payload) => {
        if (!probeVerbose) return;
        try {
          console.log("[fib-probe][browser-api]", JSON.stringify({ kind, ...payload }));
        } catch {}
      };

      const originalFetch = window.fetch;
      window.fetch = async (...args) => {
        const input = args[0];
        const url = typeof input === "string" ? input : input instanceof Request ? input.url : "";
        if (shouldLogUrl(url)) {
          log("fetch", { url });
        }
        return originalFetch(...args);
      };

      const originalOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        if (shouldLogUrl(String(url))) {
          log("xhr", { method, url: String(url) });
        }
        return originalOpen.call(this, method, url, ...rest);
      };

      const OriginalWebSocket = window.WebSocket;
      window.WebSocket = function(url, protocols) {
        const socket = new OriginalWebSocket(url, protocols);
        const socketUrl = String(url);
        if (shouldLogUrl(socketUrl) || socketUrl.includes("ws")) {
          log("websocket", { url: socketUrl });
        }

        const originalSend = socket.send.bind(socket);
        socket.send = (data) => {
          const text =
            typeof data === "string"
              ? data
              : data instanceof ArrayBuffer
                ? "[arraybuffer]"
                : ArrayBuffer.isView(data)
                  ? "[typed-array]"
                  : String(data);
          if (shouldLogMessage(text)) {
            log("websocket-send", { url: socketUrl, payload: text.slice(0, 1200) });
          }
          return originalSend(data);
        };

        socket.addEventListener("message", (event) => {
          const text =
            typeof event.data === "string"
              ? event.data
              : event.data instanceof ArrayBuffer
                ? "[arraybuffer]"
                : ArrayBuffer.isView(event.data)
                  ? "[typed-array]"
                  : String(event.data);
          try {
            const parsed = JSON.parse(text);
            const historySymbol = parsed?.echo_req?.ticks_history ?? parsed?.ohlc?.symbol;
            const historyGranularity = Number(
              parsed?.echo_req?.granularity ?? parsed?.ohlc?.granularity,
            );
            if (historySymbol && Number.isFinite(historyGranularity)) {
              const store = ensureDerivHistoryStore();
              const key = historySymbol + ":" + historyGranularity;
              const existing = store[key] ?? { candles: [], latestOhlc: null };

              if (Array.isArray(parsed?.candles)) {
                existing.candles = parsed.candles;
              }

              if (parsed?.msg_type === "ohlc" && parsed?.ohlc) {
                existing.latestOhlc = parsed.ohlc;
              }

              store[key] = existing;
            }
          } catch {}
          if (shouldLogMessage(text)) {
            log("websocket-message", { url: socketUrl, payload: text.slice(0, 1600) });
          }
        });

        return socket;
      };
      window.WebSocket.prototype = OriginalWebSocket.prototype;
      Object.setPrototypeOf(window.WebSocket, OriginalWebSocket);
    })();
  `);
}

function attachFibonacciNetworkProbe(sessionId: string, page: Page) {
  const seenRequestUrls = new Set<string>();
  const seenResponseUrls = new Set<string>();
  const seenWebsocketUrls = new Set<string>();

  page.on("console", (message) => {
    const text = message.text();
    if (!text.startsWith("[fib-probe][browser-api]")) {
      return;
    }

    if (process.env.FIB_VERBOSE_PROBE === "1") {
      console.log(text);
    }
  });

  page.on("request", (request) => {
    const url = request.url();
    const resourceType = request.resourceType();
    if (
      !isLikelyChartDataUrl(url) ||
      seenRequestUrls.has(url) ||
      (resourceType !== "xhr" && resourceType !== "fetch" && resourceType !== "websocket")
    ) {
      return;
    }

    seenRequestUrls.add(url);
    console.log("[fib-probe][request]", {
      sessionId,
      resourceType,
      method: request.method(),
      url,
    });
  });

  page.on("websocket", (websocket) => {
    const url = websocket.url();
    if (!isDerivChartProbeUrl(url) || seenWebsocketUrls.has(url)) {
      return;
    }

    seenWebsocketUrls.add(url);
    console.log("[fib-probe][websocket-url]", { sessionId, url });
  });

  page.on("response", (response) => {
    const url = response.url();
    const resourceType = response.request().resourceType();
    if (
      !isDerivChartProbeUrl(url) ||
      !isLikelyChartDataUrl(url) ||
      (resourceType !== "xhr" && resourceType !== "fetch")
    ) {
      return;
    }

    if (!seenResponseUrls.has(url)) {
      seenResponseUrls.add(url);
      console.log("[fib-probe][response-seen]", {
        sessionId,
        status: response.status(),
        resourceType,
        url,
      });
    }

    const shouldInspectPayload =
      response.ok();

    if (shouldInspectPayload) {
      void logDerivChartResponseProbe(sessionId, response);
    }
  });
}

async function inspectFibonacciChartInternals(sessionId: string, page: Page) {
  let chartFrame: ReturnType<typeof getChartFrame>;
  try {
    chartFrame = getChartFrame(page);
  } catch (error) {
    console.log("[fib-probe][widget-introspection]", {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const result = await chartFrame.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const summarizeKeys = (value: unknown, limit = 40) => {
      if (!value || (typeof value !== "object" && typeof value !== "function")) {
        return [];
      }
      return Object.getOwnPropertyNames(value).slice(0, limit);
    };
    const findInterestingMethodNames = (value: unknown) => {
      if (!value) return [];
      const keys = summarizeKeys(value, 120);
      return keys.filter((key) =>
        /time|coord|point|bar|range|index|scale/i.test(key),
      );
    };

    let widget = w.__gildoreWidget;
    if (!widget) {
      const tvMethods = ["activeChart", "chart", "onChartReady", "headerReady", "subscribe"];
      for (const key of Object.getOwnPropertyNames(w)) {
        if (key.startsWith("__") || key === "window" || key === "self") continue;
        try {
          const val = w[key];
          if (val && typeof val === "object" && !Array.isArray(val)) {
            const matches = tvMethods.filter((m) => typeof val[m] === "function").length;
            if (matches >= 3) {
              widget = val;
              break;
            }
          }
        } catch {}
      }
    }

    if (!widget) {
      return { hasWidget: false };
    }

    const chart = typeof widget.activeChart === "function" ? widget.activeChart() : null;
    const model = chart && typeof chart.model === "function" ? chart.model() : null;
    const mainSeries =
      model && typeof model.mainSeries === "function" ? model.mainSeries() : null;
    const chartWidget = chart?._chartWidget ?? null;
    const datafeedCandidate =
      widget._options?.datafeed ??
      widget._datafeed ??
      chart?._dataUpdatesConsumer?._datafeed ??
      model?._dataSourceCollection?._datafeed ??
      null;

    return {
      hasWidget: true,
      widgetKeys: summarizeKeys(widget),
      widgetProtoKeys: summarizeKeys(Object.getPrototypeOf(widget)),
      chartKeys: summarizeKeys(chart),
      chartProtoKeys: summarizeKeys(chart ? Object.getPrototypeOf(chart) : null),
      modelKeys: summarizeKeys(model),
      modelProtoKeys: summarizeKeys(model ? Object.getPrototypeOf(model) : null),
      mainSeriesKeys: summarizeKeys(mainSeries),
      mainSeriesProtoKeys: summarizeKeys(mainSeries ? Object.getPrototypeOf(mainSeries) : null),
      chartWidgetKeys: summarizeKeys(chartWidget),
      chartWidgetProtoKeys: summarizeKeys(
        chartWidget ? Object.getPrototypeOf(chartWidget) : null,
      ),
      datafeedKeys: summarizeKeys(datafeedCandidate),
      datafeedProtoKeys: summarizeKeys(
        datafeedCandidate ? Object.getPrototypeOf(datafeedCandidate) : null,
      ),
      chartInterestingMethods: findInterestingMethodNames(
        chart ? Object.getPrototypeOf(chart) : null,
      ),
      chartWidgetInterestingMethods: findInterestingMethodNames(
        chartWidget ? Object.getPrototypeOf(chartWidget) : null,
      ),
      modelInterestingMethods: findInterestingMethodNames(
        model ? Object.getPrototypeOf(model) : null,
      ),
      mainSeriesInterestingMethods: findInterestingMethodNames(
        mainSeries ? Object.getPrototypeOf(mainSeries) : null,
      ),
      chartSymbol:
        chart && typeof chart.symbol === "function" ? chart.symbol() : null,
      chartResolution:
        chart && typeof chart.resolution === "function" ? chart.resolution() : null,
    };
  }).catch((error) => ({
    error: error instanceof Error ? error.message : String(error),
  }));

  console.log("[fib-probe][widget-introspection]", { sessionId, result });
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

// Deriv's TradingView uses its own internal symbol names. Map our arena market
// symbols to a search term that returns results, plus a pattern to click the
// correct row when multiple results appear.
const DERIV_SYMBOL_SEARCH: Record<string, { term: string; selectPattern: RegExp; category?: string }> = {
  "XAU/USD": { term: "xau", selectPattern: /FRXXAUUSD|GOLD\/USD|XAU/i, category: "Commodities" },
  "XAG/USD": { term: "xag", selectPattern: /FRXXAGUSD|SILVER|XAG/i, category: "Commodities" },
  "EUR/USD": { term: "eurusd", selectPattern: /EURUSD|EUR\/USD/i, category: "Forex" },
  "GBP/USD": { term: "gbpusd", selectPattern: /GBPUSD|GBP\/USD/i, category: "Forex" },
};

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

  // Resolve Deriv-specific search term, result-row pattern, and category tab.
  const derivOverride = DERIV_SYMBOL_SEARCH[marketSymbol];
  const searchTerm = derivOverride?.term ?? marketSymbol;
  const selectPattern = derivOverride?.selectPattern ?? new RegExp(escapeRegExp(marketSymbol), "i");

  // Click the appropriate category tab before searching.
  // Synthetic indices need "Derived"; commodities need "Commodities"; forex needs "Forex".
  // Falling back to "Derived" for any unrecognised market (legacy default).
  const categoryTab = derivOverride?.category
    ?? (/volatility|crash|boom|step|jump/i.test(marketSymbol) ? "Derived" : null);

  if (categoryTab) {
    setActionLabel(sessionId, `Selecting ${categoryTab} category`);
    await clickLocatorWithTelemetry(
      sessionId,
      page,
      chartFrame.getByText(new RegExp(`^${categoryTab}$`, "i")).first(),
    ).catch(() => {});
    await page.waitForTimeout(400);
  }

  setActionLabel(sessionId, `Searching for ${marketSymbol}`);
  const searchInput = chartFrame.locator('input[placeholder="Search"]').first();
  const filledSearch = await searchInput
    .fill(searchTerm)
    .then(() => true)
    .catch(() => false);

  if (!filledSearch) {
    throw new Error("Could not find the Deriv symbol search input.");
  }

  await page.waitForTimeout(1200);

  setActionLabel(sessionId, `Selecting ${marketSymbol} from results`);
  const selectedSymbol = await clickLocatorWithTelemetry(
    sessionId,
    page,
    chartFrame.getByText(selectPattern, { exact: false }).first(),
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

export type ThirdTouchT2Candidate = {
  id: string;
  timeSec: number;
  price: number;
  note: string;
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
  t1ExactTimeSec?: number;
  t2ExactTimeSec?: number;
  skipHaikuLocate?: boolean;
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

  // ── Phase 1: 8h — show the current structural cycle, NOT ancient history ────────
  // Goal: let the agent see the trough that STARTED the current active trend
  // (e.g. a Jan/Feb 2026 bottom after a Nov 2025 selloff), not pre-2025 data.
  // View 1 = broad 8h view showing ~4 months: regime, dominant swings, trend direction.
  // View 2 = same 8h, panned slightly left to put the CURRENT TREND ORIGIN at the
  //           left-centre of the frame, with the full rally to present on the right.
  setActionLabel(sessionId, "Switching to 8h — current structural cycle view");
  await switchDerivTimeframe(sessionId, page, "8h");
  await page.waitForTimeout(300);
  const frameBox8h = await chartFrame.locator("body").boundingBox().catch(() => null);
  const f8hCx = frameBox8h ? frameBox8h.x + frameBox8h.width * 0.5 : chartCx;
  const f8hCy = frameBox8h ? frameBox8h.y + frameBox8h.height * 0.4 : chartCy;
  await page.waitForTimeout(1200);
  await dismissDerivTooltips(page, chartFrame);
  await page.waitForTimeout(300);
  await page.mouse.click(f8hCx, f8hCy);
  await page.waitForTimeout(200);
  await page.mouse.move(f8hCx, f8hCy);
  // Moderate zoom-out: show ~4 months of 8h candles. This puts the current
  // trend origin (a recent major trough) in the left portion of the frame
  // while keeping current price visible on the right.
  await page.mouse.wheel(0, 2500);
  await page.waitForTimeout(700);
  await snap("View 1/6 — 8h current structural cycle (~4 months): regime direction, dominant trend, recent major swings");

  // Pan slightly LEFT (toward older data) so the trough that STARTED the current
  // rally is near the left edge. 300px is enough to expose the origin without
  // sliding into irrelevant ancient history.
  setActionLabel(sessionId, "8h: centering on the current trend origin");
  await dragPointerWithTelemetry({
    sessionId, page,
    from: { x: chartCx, y: chartCy },
    to: { x: chartCx + 300, y: chartCy },
    steps: 15,
  });
  await snap("View 2/6 — 8h current trend origin: the trough that LAUNCHED the active rally is visible near the left; full rally to present on the right");

  // ── Phase 2: Return to trading timeframe — use setVisibleRange for precise T1 ──
  // Goal: show Jan 1 through current+30d so T1 (Feb 7-8) appears at ~25-30%
  // from the left — well clear of the left edge, preventing the agent from
  // picking the leftmost visible candle (Feb 22) as T1 instead of the true trough.
  setActionLabel(sessionId, `Switching to ${targetTimeframe} — setting precise view from Jan to current`);
  await switchDerivTimeframe(sessionId, page, targetTimeframe);
  await page.waitForTimeout(500);

  const frameBox = await chartFrame.locator("body").boundingBox().catch(() => null);
  const fCx = frameBox ? frameBox.x + frameBox.width * 0.5 : chartCx;
  const fCy = frameBox ? frameBox.y + frameBox.height * 0.4 : chartCy;

  await page.waitForTimeout(1200);
  await dismissDerivTooltips(page, chartFrame);
  await page.waitForTimeout(300);
  await page.mouse.click(fCx, fCy);
  await page.waitForTimeout(300);

  // Try to set a precise visible range via the chart API.
  // Show the last 90 days from current — this is market-agnostic: 90 days of 4h
  // candles always covers the structural T1 origin of a multi-week/multi-month rally
  // without showing so much history that older-cycle lows confuse the agent.
  const nowForRange = Math.floor(Date.now() / 1000) + 14 * 86400;  // current + 2-week buffer
  const ninetyDaysAgo = nowForRange - 90 * 86400 - 14 * 86400;    // ~104 days total window
  const rangeSet = await chartFrame.evaluate(({ from, to }: { from: number; to: number }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    let widget = w.__gildoreWidget;
    if (!widget) {
      for (const key of Object.getOwnPropertyNames(w)) {
        try {
          const val = w[key];
          if (val && typeof val === "object" && typeof val.activeChart === "function" && typeof val.chart === "function") {
            widget = val; break;
          }
        } catch { /* skip */ }
      }
    }
    if (!widget) return false;
    try { widget.activeChart().setVisibleRange({ from, to }); return true; }
    catch { return false; }
  }, { from: ninetyDaysAgo, to: nowForRange }).catch(() => false);

  if (rangeSet) {
    console.log("[captureStrategyScreenshots] setVisibleRange succeeded (Jan 1 – current+30d)");
    await page.waitForTimeout(600);
  } else {
    // Fallback: wheel zoom to approximate the same range
    console.log("[captureStrategyScreenshots] setVisibleRange failed — falling back to wheel zoom");
    await page.mouse.move(fCx, fCy);
    await page.mouse.wheel(0, 12000);
    await page.waitForTimeout(900);
    await dragPointerWithTelemetry({ sessionId, page, from: { x: fCx, y: fCy }, to: { x: fCx + 700, y: fCy }, steps: 35 });
    await page.waitForTimeout(400);
  }
  await autoScaleYAxis(page);

  await snap(`View 3/6 — ${targetTimeframe} full structure Jan→now: T1 (Feb 7-8 structural trough) visible at ~25% from left, current price at right`);

  // View 4: minor right pan to expose the T1 low more clearly
  setActionLabel(sessionId, "Centring T1 region");
  await dragPointerWithTelemetry({ sessionId, page, from: { x: chartCx, y: chartCy }, to: { x: chartCx + 200, y: chartCy }, steps: 10 });
  await snap(`View 4/6 — ${targetTimeframe} T1 region centred: wick low of Feb 7-8 visible, T2 (first higher low) to the right`);

  // View 5: pan back to show the T1→T2 slope and post-T2 rally
  setActionLabel(sessionId, "T1→T2 slope view");
  await dragPointerWithTelemetry({ sessionId, page, from: { x: chartCx, y: chartCy }, to: { x: chartCx - 200, y: chartCy }, steps: 10 });
  await snap(`View 5/6 — ${targetTimeframe} T1→T2 ascending slope and post-T2 rally, T3 zone approaching`);

  // ── Phase 3: Drawing canvas ───────────────────────────────────────────────────
  // Return to the base Jan–current range (undo the View 4/5 pans).
  setActionLabel(sessionId, "Drawing canvas — full structure T1→current");
  await dragPointerWithTelemetry({ sessionId, page, from: { x: chartCx, y: chartCy }, to: { x: chartCx + 200, y: chartCy }, steps: 10 });
  await autoScaleYAxis(page);
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
  t1: { price: number; xPct?: number; dateUtcSec?: number; exactTimeSec?: number },
  t2: { price: number; xPct?: number; dateUtcSec?: number; exactTimeSec?: number },
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
        t1: { price: number; xPct?: number; dateUtcSec?: number; exactTimeSec?: number };
        t2: { price: number; xPct?: number; dateUtcSec?: number; exactTimeSec?: number };
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

        // ── Timestamp strategy ─────────────────────────────────────────────────
        // The Deriv chart's internal timestamps differ from standard UTC Unix time
        // by a constant offset (~10-14 days for VIX10). If we use Date.parse()
        // values directly, every anchor lands that many days too early visually.
        //
        // Fix: treat T2's xPct-derived time as the ground truth (it comes directly
        // from the chart's own getVisibleRange(), so it IS in chart-native time).
        // Derive T1 and zone times RELATIVE to T2's native time using calendar deltas.
        //
        // Priority: xPct (chart-native) > dateUtcSec (UTC, needs offset correction)

        // T2: always prefer xPct over date — xPct is chart-native
        const t2Time =
          t2.exactTimeSec
          ?? (t2.xPct !== undefined ? xPctToTime(t2.xPct) : (t2.dateUtcSec ?? null));
        if (!t2Time) return { ok: false, reason: "no time source for T2" };

        // Compute chart-native ↔ UTC offset from T2 (only valid when both sources available)
        const chartUtcOffset = (t2.xPct !== undefined && t2.dateUtcSec)
          ? xPctToTime(t2.xPct) - t2.dateUtcSec   // chart_native = UTC + offset
          : 0;

        // T1: use xPct if on-screen, otherwise apply the UTC offset to T1's date
        const t1Time =
          t1.exactTimeSec
          ?? (t1.xPct !== undefined
            ? xPctToTime(t1.xPct)
            : (t1.dateUtcSec !== undefined ? t1.dateUtcSec + chartUtcOffset : null));
        if (!t1Time) return { ok: false, reason: "no time source for T1" };

        // Slope sanity
        if (t2Time <= t1Time) return { ok: false, reason: "T2 timestamp ≤ T1 — inverted or same time" };

        // Current time in chart-native coordinates
        const nowSec = Math.floor(Date.now() / 1000);
        const nowChartTime = nowSec + chartUtcOffset;

        // Zone at current time (T3 interaction area)
        const zoneStartTime = nowChartTime - 5 * 24 * 3600;
        const zoneEndTime   = nowChartTime + 10 * 24 * 3600;

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

        // Draw projected interaction zone as a rectangle at the T3 area (current date)
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

        // Reposition chart so T1 is near the left edge and current date is near the right.
        // Cap the left boundary at 21 days before T1 — this is market-agnostic:
        // enough context to show the decline into T1 without exposing data from a
        // previous market cycle that would confuse the Sonnet verification loop.
        const MIN_BEFORE_T1_SEC = 21 * 24 * 3600;
        const rawPaddingLeft = t1Time - (nowChartTime - t1Time) * 0.15;
        const paddingLeft = Math.max(t1Time - MIN_BEFORE_T1_SEC, rawPaddingLeft);
        const paddingRight = nowChartTime + (nowChartTime - t1Time) * 0.05;
        try {
          chart.setVisibleRange({ from: Math.round(paddingLeft), to: Math.round(paddingRight) });
        } catch { /* non-fatal */ }

        return { ok: true, t1Time, t2Time, chartUtcOffset, range };
      },
      { t1, t2, zone } as {
        t1: { price: number; xPct?: number; dateUtcSec?: number; exactTimeSec?: number };
        t2: { price: number; xPct?: number; dateUtcSec?: number; exactTimeSec?: number };
        zone: { low: number; high: number };
      },
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
  // T2's viewSixPos is sufficient to preserve the View 6 chart state for drawing.
  // T1 being off-screen (null) is fine — it gets placed via date+chartUtcOffset.
  // If we zoom-out here (old behaviour when T1 was null), the range changes and
  // T2's xPct maps to the wrong timestamp, producing the wrong slope.
  const hasAgentPositions = agentT2Pos !== undefined;
  const shouldUseHaikuLocate = !hasAgentPositions && overlay?.skipHaikuLocate !== true;

  setActionLabel(sessionId, "Settling chart for structure marking");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  const chartFrame = getChartFrame(page);

  if (hasAgentPositions) {
    // Chart is still in the View 6 state — preserve it so T2's xPct maps correctly.
    setActionLabel(sessionId, "Preserving View 6 drawing canvas — T2 position valid");
    await dismissDerivTooltips(page, chartFrame);
  } else {
    // Neither anchor visible — zoom out to get any usable view.
    setActionLabel(sessionId, "Zooming to drawing canvas — no anchor positions available");
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

  if (shouldUseHaikuLocate) {
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
    // T2 position is confirmed (hasAgentPositions = agentT2Pos !== undefined).
    // T1 may be off-screen (agentT1Pos === undefined) — fall back to far-left estimate.
    t2X = agentT2Pos!.xPct * viewport.width;
    t2Y = agentT2Pos!.yPct * viewport.height;
    if (agentT1Pos) {
      t1X = agentT1Pos.xPct * viewport.width;
      t1Y = agentT1Pos.yPct * viewport.height;
    } else {
      // T1 off-screen: place at the far-left edge of the chart canvas at T1 price.
      t1X = CL + CW * 0.04;
      t1Y = priceToY(sp.t1Price);
    }
    console.log("[drawing] using agent View-6 pixel positions", {
      t1: { x: Math.round(t1X), y: Math.round(t1Y), price: sp.t1Price, fromAgent: Boolean(agentT1Pos) },
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

  // Clamp cursor walk positions to the chart canvas — never move into the
  // drawing toolbar (x < CL) or date axis (y > CB) which can trigger UI controls.
  const safeCursorX = (x: number) => Math.max(CL + 5, Math.min(CR - 5, x));
  const safeCursorY = (y: number) => Math.max(CT + 5, Math.min(CB - 5, y));

  setActionLabel(sessionId, `T1 — first structural ${isLong ? "swing low" : "swing high"} at ${sp.t1Price}`);
  await movePointerWithTelemetry({ sessionId, page, to: { x: safeCursorX(t1X), y: safeCursorY(t1Y) }, steps: 18 });
  await updatePointer(sessionId, page, { x: safeCursorX(t1X), y: safeCursorY(t1Y), click: true });
  await page.waitForTimeout(600);

  setActionLabel(sessionId, `T2 — ${isLong ? "higher low" : "lower high"} at ${sp.t2Price} — slope confirmed`);
  await movePointerWithTelemetry({ sessionId, page, to: { x: safeCursorX(t2X), y: safeCursorY(t2Y) }, steps: 18 });
  await updatePointer(sessionId, page, { x: safeCursorX(t2X), y: safeCursorY(t2Y), click: true });
  await page.waitForTimeout(600);

  // ── 5. Draw via Charting Library JS API ──────────────────────────────────────
  // Prefer the JS API (zero mouse automation, instant, extend-right built-in).
  // Works even when T1 is off-screen: agent provides an ISO date that converts
  // directly to a Unix timestamp without needing pixel coordinate interpolation.
  const drawT1Pos = overlay?.t1ViewSixPos;
  const drawT2Pos = overlay?.t2ViewSixPos;
  const t1DateUtcSec = overlay?.t1Date ? Math.round(Date.parse(overlay.t1Date + "T12:00:00Z") / 1000) : undefined;
  const t2DateUtcSec = overlay?.t2Date ? Math.round(Date.parse(overlay.t2Date + "T12:00:00Z") / 1000) : undefined;
  const t1ExactTimeSec = overlay?.t1ExactTimeSec;
  const t2ExactTimeSec = overlay?.t2ExactTimeSec;

  // Can draw via API if we have a time source for both anchors:
  // either viewSixPos.xPct (on-screen) or a date string (off-screen).
  const t1HasTime = drawT1Pos !== undefined || t1DateUtcSec !== undefined || t1ExactTimeSec !== undefined;
  const t2HasTime = drawT2Pos !== undefined || t2DateUtcSec !== undefined || t2ExactTimeSec !== undefined;

  if (t1HasTime && t2HasTime) {
    setActionLabel(sessionId, "Drawing structure via Charting Library API");
    const apiOk = await drawWithChartApi(
      page,
      sessionId,
      { price: sp.t1Price, xPct: drawT1Pos?.xPct, dateUtcSec: t1DateUtcSec, exactTimeSec: t1ExactTimeSec },
      { price: sp.t2Price, xPct: drawT2Pos?.xPct, dateUtcSec: t2DateUtcSec, exactTimeSec: t2ExactTimeSec },
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
      if (args.agentSlug === "third-touch" && !base) {
        console.warn("[browser-session-runtime] exact swingPoints missing for third-touch — skipping drawing", {
          sessionId: args.sessionId,
          agentSlug: args.agentSlug,
          marketSymbol: args.agentMarketSymbol,
        });
        setActionLabel(
          args.sessionId,
          "Third-touch exact anchors unavailable — skipping chart draw",
        );
        await page.waitForTimeout(1200);
        setActionLabel(args.sessionId, undefined);
        console.log("[browser-session-runtime] session ready without third-touch drawing", {
          sessionId: args.sessionId,
          screenshotPath,
        });
        return {
          ok: true,
          screenshotPath,
          reused: false,
        };
      }
      const t1Price = base?.t1Price ?? decision.correctedT1?.price;
      const t2Price = base?.t2Price ?? decision.correctedT2?.price;
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
          t1ExactTimeSec: base?.t1TimeSec,
          t2ExactTimeSec: base?.t2TimeSec,
          skipHaikuLocate: true,
        });
        await capture(args.sessionId);
        console.log("[browser-session-runtime] mapped structure drawn", {
          sessionId: args.sessionId,
        });

        // ── Iterative refinement loop (up to 5 Sonnet passes) ───────────────
        // Pass 1: Haiku quick check (fast/cheap binary slope guard).
        // Passes 2-5: Sonnet iterative refinement — each pass takes a screenshot,
        // assesses T1/T2 correctness and line quality, then redraws with corrected
        // dates if needed. Loop exits when Sonnet confirms or max passes reached.
        try {
          // ── Pass 1: Haiku slope guard ────────────────────────────────────
          setActionLabel(args.sessionId, "Pass 1 — Haiku slope check");
          const verifyBuf = await captureToBuffer(page);
          const verification = await verifyChartDrawing(
            verifyBuf,
            { price: t1Price, date: decision.correctedT1?.date },
            { price: t2Price, date: decision.correctedT2?.date },
            { low: zoneLow, high: zoneHigh },
          );
          console.log("[pass-1/haiku]", verification.assessment, "—", verification.note);

          if (verification.assessment !== "correct") {
            const t1TimeSec = base?.t1TimeSec;
            const t2TimeSec = base?.t2TimeSec;
            let corrT2TimeSec = t2TimeSec;
            if (t1TimeSec && t2TimeSec && (t2TimeSec - t1TimeSec) / 86400 < 8) {
              corrT2TimeSec = t1TimeSec + 14 * 86400;
              console.log(`[pass-1/haiku] T2 pushed to ${formatUtcDateFromSec(corrT2TimeSec)}`);
            }
            setActionLabel(args.sessionId, `Pass 1 — slope fix, T2 → ${corrT2TimeSec ? formatUtcDateFromSec(corrT2TimeSec) : "current"}`);
            await identifySwingPointsOnChart(args.sessionId, page, drawPoints, {
              structureStatus: decision.structureStatus,
              verdict: decision.verdict,
              t1ExactTimeSec: t1TimeSec,
              t2ExactTimeSec: corrT2TimeSec,
              skipHaikuLocate: true,
            });
            await capture(args.sessionId);
          }

          // ── Passes 2-5: Sonnet iterative refinement ──────────────────────
          const MAX_SONNET_PASSES = 4;
          let curT1Date = base?.t1TimeSec ? formatUtcDateFromSec(base.t1TimeSec) : decision.correctedT1?.date;
          let curT2Date = base?.t2TimeSec ? formatUtcDateFromSec(base.t2TimeSec) : decision.correctedT2?.date;
          let curT1Price = t1Price;
          let curT2Price = t2Price;
          let curT1TimeSec = base?.t1TimeSec;
          let curT2TimeSec = base?.t2TimeSec;
          const granularity = timeframeToDerivGranularity(args.timeframe);
          const derivSnapshot = await collectDerivHistorySnapshot(args.sessionId, page, granularity);
          const derivCandles = derivSnapshot ? mergeDerivCandles(derivSnapshot) : [];
          const t2Candidates = deriveThirdTouchT2Candidates({
            candles: derivCandles,
            direction,
            t1TimeSec: curT1TimeSec,
            t1Price: curT1Price,
            t2TimeSec: curT2TimeSec,
            t2Price: curT2Price,
            t3TimeSec: drawPoints.t3TimeSec,
            granularitySec: granularity,
          });

          for (let pass = 0; pass < MAX_SONNET_PASSES; pass++) {
            setActionLabel(args.sessionId, `Pass ${pass + 2} — Sonnet structural check`);
            const confirmBuf = await captureToBuffer(page);
            const confirmation = await confirmStructureWithSonnet(
              confirmBuf,
              { price: curT1Price, date: curT1Date },
              { price: curT2Price, date: curT2Date },
              t2Candidates,
            );
            console.log(`[pass-${pass + 2}/sonnet]`, {
              confirmed: confirmation.confirmed,
              t1Correct: confirmation.t1Correct,
              t2Correct: confirmation.t2Correct,
              note: confirmation.note,
              selectedT2CandidateId: confirmation.selectedT2CandidateId ?? null,
            });

            if (confirmation.confirmed) {
              console.log(`[refinement] confirmed on pass ${pass + 2} ✓`);
              break;
            }

            const selectedCandidate =
              confirmation.selectedT2CandidateId &&
              confirmation.selectedT2CandidateId !== "KEEP_CURRENT"
                ? t2Candidates.find((candidate) => candidate.id === confirmation.selectedT2CandidateId)
                : null;

            if (!selectedCandidate) {
              console.log(`[refinement] no change in pass ${pass + 2} — stopping`);
              break;
            }

            if (
              selectedCandidate.timeSec === curT2TimeSec &&
              selectedCandidate.price === curT2Price
            ) {
              console.log(`[refinement] candidate ${selectedCandidate.id} matches current T2 — stopping`);
              break;
            }

            curT2TimeSec = selectedCandidate.timeSec;
            curT2Date = formatUtcDateFromSec(selectedCandidate.timeSec);
            curT2Price = selectedCandidate.price;

            setActionLabel(args.sessionId, `Pass ${pass + 2} — redrawing T1=${curT1Date} T2=${curT2Date}`);
            const refineDrawPoints: SwingPointsForBrowser = {
              ...drawPoints,
              t1Price: curT1Price,
              t1TimeSec: curT1TimeSec,
              t2Price: curT2Price,
              t2TimeSec: curT2TimeSec,
            };
            await identifySwingPointsOnChart(args.sessionId, page, refineDrawPoints, {
              structureStatus: decision.structureStatus,
              verdict: decision.verdict,
              t1ExactTimeSec: curT1TimeSec,
              t2ExactTimeSec: curT2TimeSec,
              skipHaikuLocate: true,
            });
            await capture(args.sessionId);
            console.log(`[refinement] pass ${pass + 2} redraw complete`);
          }
        } catch (refineErr) {
          console.warn("[refinement] error (non-fatal):", refineErr);
        }
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

export type FibonacciLegForBrowser = {
  lowTimeSec: number;
  lowPrice: number;
  highTimeSec: number;
  highPrice: number;
  isMuted: boolean;
};

type DerivProbeCandle = {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

type DerivProbeOhlc = {
  symbol: string;
  granularity: number;
  open_time: number;
  epoch: number;
  open: string;
  high: string;
  low: string;
  close: string;
  pip_size?: number;
};

type DerivHistorySnapshot = {
  symbol: string;
  granularity: number;
  candles: DerivProbeCandle[];
  latestOhlc: DerivProbeOhlc | null;
};

function timeframeToDerivGranularity(timeframe: string) {
  const granularityMap: Record<string, number> = {
    "15m": 900,
    "1h": 3600,
    "4h": 14400,
    "8h": 28800,
    "1d": 86400,
  };

  return granularityMap[timeframe] ?? 900;
}

async function collectDerivHistorySnapshot(
  sessionId: string,
  page: Page,
  granularity: number,
): Promise<DerivHistorySnapshot | null> {
  const collectFromContext = async (target: Page | Frame) =>
    await target.evaluate(({ granularity }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      let widget = w.__gildoreWidget;
      if (!widget) {
        const tvMethods = ["activeChart", "chart", "onChartReady", "headerReady", "subscribe"];
        for (const key of Object.getOwnPropertyNames(w)) {
          if (key.startsWith("__") || key === "window" || key === "self") continue;
          try {
            const val = w[key];
            if (val && typeof val === "object" && !Array.isArray(val)) {
              const matches = tvMethods.filter((m) => typeof val[m] === "function").length;
              if (matches >= 3) {
                widget = val;
                break;
              }
            }
          } catch {}
        }
      }

      if (!widget || typeof widget.activeChart !== "function") {
        return null;
      }

      const chart = widget.activeChart();
      const symbol =
        chart && typeof chart.symbol === "function" ? chart.symbol() : null;
      if (!symbol) {
        return null;
      }

      const store = w.__fibProbeDerivHistory ?? {};
      const entry = store[`${symbol}:${granularity}`];
      if (!entry) {
        return { symbol, granularity, candles: [], latestOhlc: null };
      }

      return {
        symbol,
        granularity,
        candles: Array.isArray(entry.candles) ? entry.candles : [],
        latestOhlc: entry.latestOhlc ?? null,
      };
    }, { granularity }).catch(() => null);

  const contexts: Array<Page | Frame> = [page, ...page.frames()];
  const snapshots = await Promise.all(contexts.map((context) => collectFromContext(context)));
  const snapshot = snapshots.find(
    (candidate) => candidate && (candidate.candles.length > 0 || candidate.latestOhlc),
  ) ?? snapshots.find((candidate) => candidate?.symbol);

  if (!snapshot) {
    console.warn("[fib-resolve] no deriv snapshot available", {
      sessionId,
      granularity,
    });
    return null;
  }

  return snapshot as DerivHistorySnapshot;
}

function mergeDerivCandles(snapshot: DerivHistorySnapshot): DerivProbeCandle[] {
  const merged = new Map<number, DerivProbeCandle>();

  for (const candle of snapshot.candles) {
    if (
      !Number.isFinite(candle.epoch) ||
      !Number.isFinite(candle.open) ||
      !Number.isFinite(candle.high) ||
      !Number.isFinite(candle.low) ||
      !Number.isFinite(candle.close)
    ) {
      continue;
    }

    merged.set(candle.epoch, {
      epoch: candle.epoch,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    });
  }

  if (snapshot.latestOhlc) {
    const openTime = snapshot.latestOhlc.open_time;
    if (Number.isFinite(openTime)) {
      merged.set(openTime, {
        epoch: openTime,
        open: Number(snapshot.latestOhlc.open),
        high: Number(snapshot.latestOhlc.high),
        low: Number(snapshot.latestOhlc.low),
        close: Number(snapshot.latestOhlc.close),
      });
    }
  }

  return [...merged.values()].sort((left, right) => left.epoch - right.epoch);
}

function scoreDerivPivotCandidate(args: {
  candle: DerivProbeCandle;
  targetTimeSec: number;
  targetPrice: number;
  pivotKind: "low" | "high";
}) {
  const price = args.pivotKind === "low" ? args.candle.low : args.candle.high;
  const priceDelta = Math.abs(price - args.targetPrice);
  const priceWeight = Math.max(Math.abs(args.targetPrice) * 0.0025, 2.5);
  const timeDeltaHours = Math.abs(args.candle.epoch - args.targetTimeSec) / 3600;
  return priceDelta / priceWeight + timeDeltaHours / 24;
}

function resolveNearestDerivPivot(args: {
  candles: DerivProbeCandle[];
  targetTimeSec: number;
  targetPrice: number;
  pivotKind: "low" | "high";
  timeWindowSec: number;
}) {
  const candidates = args.candles.filter(
    (candle) =>
      Math.abs(candle.epoch - args.targetTimeSec) <= args.timeWindowSec,
  );
  const searchSpace = candidates.length > 0 ? candidates : args.candles;

  let best: DerivProbeCandle | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candle of searchSpace) {
    const score = scoreDerivPivotCandidate({
      candle,
      targetTimeSec: args.targetTimeSec,
      targetPrice: args.targetPrice,
      pivotKind: args.pivotKind,
    });
    if (score < bestScore) {
      bestScore = score;
      best = candle;
    }
  }

  return best;
}

function resolveFibonacciLegsToDerivCandles(args: {
  legs: FibonacciLegForBrowser[];
  candles: DerivProbeCandle[];
  direction?: "long" | "short";
  granularity: number;
}) {
  const resolvedLegs: FibonacciLegForBrowser[] = [];

  for (const leg of args.legs) {
    const timeWindowSec = Math.max(args.granularity * 96, 7 * 24 * 3600);
    const lowCandidate = resolveNearestDerivPivot({
      candles: args.candles,
      targetTimeSec: leg.lowTimeSec,
      targetPrice: leg.lowPrice,
      pivotKind: args.direction === "short" ? "high" : "low",
      timeWindowSec,
    });
    const highCandidate = resolveNearestDerivPivot({
      candles: args.candles.filter((candle) =>
        lowCandidate ? candle.epoch >= lowCandidate.epoch : true,
      ),
      targetTimeSec: leg.highTimeSec,
      targetPrice: leg.highPrice,
      pivotKind: args.direction === "short" ? "low" : "high",
      timeWindowSec,
    });

    if (!lowCandidate || !highCandidate) {
      return null;
    }

    const resolvedLowTimeSec = lowCandidate.epoch;
    const resolvedHighTimeSec = highCandidate.epoch;
    if (resolvedHighTimeSec <= resolvedLowTimeSec) {
      return null;
    }

    resolvedLegs.push({
      ...leg,
      lowTimeSec: resolvedLowTimeSec,
      highTimeSec: resolvedHighTimeSec,
    });
  }

  return resolvedLegs;
}

function shiftFibonacciLegsByBars(
  legs: FibonacciLegForBrowser[],
  shiftBars: number,
  granularitySec: number,
) {
  if (shiftBars === 0) return legs;
  const shiftSec = shiftBars * granularitySec;
  return legs.map((leg) => ({
    ...leg,
    lowTimeSec: leg.lowTimeSec + shiftSec,
    highTimeSec: leg.highTimeSec + shiftSec,
  }));
}

function formatUtcDateFromSec(timeSec: number) {
  return new Date(timeSec * 1000).toISOString().slice(0, 10);
}

function deriveThirdTouchT2Candidates(args: {
  candles: DerivProbeCandle[];
  direction: "long" | "short";
  t1TimeSec?: number;
  t1Price: number;
  t2TimeSec?: number;
  t2Price: number;
  t3TimeSec?: number;
  granularitySec: number;
}): ThirdTouchT2Candidate[] {
  const {
    candles,
    direction,
    t1TimeSec,
    t1Price,
    t2TimeSec,
    t2Price,
    t3TimeSec,
    granularitySec,
  } = args;

  if (!t1TimeSec || candles.length < 5) {
    return t2TimeSec
      ? [{
          id: "C0",
          timeSec: t2TimeSec,
          price: t2Price,
          note: `Current exact T2 (${formatUtcDateFromSec(t2TimeSec)})`,
        }]
      : [];
  }

  const searchEndSec = t3TimeSec ?? candles[candles.length - 1]?.epoch ?? t1TimeSec;
  const minGapBars = 4;
  const maxCandidates = 6;

  const candidates: Array<ThirdTouchT2Candidate & { score: number }> = [];
  const currentKey = t2TimeSec ? `${t2TimeSec}:${t2Price}` : null;

  for (let i = 2; i < candles.length - 2; i += 1) {
    const candle = candles[i];
    if (candle.epoch <= t1TimeSec + granularitySec * minGapBars) continue;
    if (candle.epoch >= searchEndSec) break;

    const prev1 = candles[i - 1];
    const prev2 = candles[i - 2];
    const next1 = candles[i + 1];
    const next2 = candles[i + 2];

    if (direction === "long") {
      const isLocalLow =
        candle.low <= prev1.low &&
        candle.low <= prev2.low &&
        candle.low <= next1.low &&
        candle.low <= next2.low &&
        candle.low > t1Price;
      if (!isLocalLow) continue;

      const rebound = Math.max(
        ...candles.slice(i + 1, Math.min(candles.length, i + 9)).map((entry) => entry.high),
      ) - candle.low;
      const separationBars = (candle.epoch - t1TimeSec) / granularitySec;
      const score = rebound + Math.min(separationBars, 24) * 0.02;
      candidates.push({
        id: `C${candidates.length + 1}`,
        timeSec: candle.epoch,
        price: candle.low,
        note: `Higher-low candidate on ${formatUtcDateFromSec(candle.epoch)}`,
        score,
      });
      continue;
    }

    const isLocalHigh =
      candle.high >= prev1.high &&
      candle.high >= prev2.high &&
      candle.high >= next1.high &&
      candle.high >= next2.high &&
      candle.high < t1Price;
    if (!isLocalHigh) continue;

    const rejection =
      candle.high - Math.min(
        ...candles.slice(i + 1, Math.min(candles.length, i + 9)).map((entry) => entry.low),
      );
    const separationBars = (candle.epoch - t1TimeSec) / granularitySec;
    const score = rejection + Math.min(separationBars, 24) * 0.02;
    candidates.push({
      id: `C${candidates.length + 1}`,
      timeSec: candle.epoch,
      price: candle.high,
      note: `Lower-high candidate on ${formatUtcDateFromSec(candle.epoch)}`,
      score,
    });
  }

  const deduped = candidates
    .sort((left, right) => left.timeSec - right.timeSec || right.score - left.score)
    .filter((candidate, index, all) =>
      index === 0 ||
      Math.abs(candidate.timeSec - all[index - 1].timeSec) >= granularitySec * 4,
    )
    .sort((left, right) => right.score - left.score)
    .slice(0, maxCandidates - (currentKey ? 1 : 0))
    .sort((left, right) => left.timeSec - right.timeSec)
    .map(({ score: _score, ...candidate }) => candidate);

  const withCurrent = t2TimeSec
    ? [
        {
          id: "C0",
          timeSec: t2TimeSec,
          price: t2Price,
          note: `Current exact T2 (${formatUtcDateFromSec(t2TimeSec)})`,
        },
        ...deduped.filter((candidate) => `${candidate.timeSec}:${candidate.price}` !== currentKey),
      ]
    : deduped;

  return withCurrent.slice(0, maxCandidates);
}

async function drawFibonacciWithChartApiLegacy(
  page: Page,
  sessionId: string,
  legs: FibonacciLegForBrowser[],
  preferredZone?: { low: number; high: number },
  direction?: "long" | "short",
): Promise<boolean> {
  let chartFrame: ReturnType<typeof getChartFrame>;
  try {
    chartFrame = getChartFrame(page);
  } catch (err) {
    console.error("[fib-drawing-api] chart frame not found:", err);
    return false;
  }

  const result = await chartFrame.evaluate(
    ({ legs, preferredZone, isShort }: {
      legs: FibonacciLegForBrowser[];
      preferredZone?: { low: number; high: number };
      isShort: boolean;
    }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      let widget = w.__gildoreWidget;

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
          } catch {}
        }
      }

      if (!widget) return { ok: false, reason: "widget not found in iframe" };

      let chart: ReturnType<typeof widget.activeChart>;
      try { chart = widget.activeChart(); } catch (e) {
        return { ok: false, reason: "activeChart() failed: " + String(e) };
      }

      const range = chart.getVisibleRange() as { from: number; to: number } | null;
      if (!range?.from || !range?.to) return { ok: false, reason: "no visible range" };

      const nowSec = Math.floor(Date.now() / 1000);
      const chartUtcOffset = range.to - nowSec;
      const earliest = Math.min(...legs.map((l) => l.lowTimeSec));
      const fromChart = (earliest - 15 * 86400) + chartUtcOffset;
      const toChart = nowSec + chartUtcOffset + 7 * 86400;
      try {
        chart.setVisibleRange({ from: Math.round(fromChart), to: Math.round(toChart) });
      } catch {}

      try { chart.removeAllShapes(); } catch {}

      let drawn = 0;
      for (const leg of legs) {
        const lowTime = Math.round(leg.lowTimeSec + chartUtcOffset);
        const highTime = Math.round(leg.highTimeSec + chartUtcOffset);
        const points = isShort
          ? [{ time: lowTime, price: leg.highPrice }, { time: highTime, price: leg.lowPrice }]
          : [{ time: lowTime, price: leg.lowPrice }, { time: highTime, price: leg.highPrice }];
        try {
          chart.createMultipointShape(points, {
            shape: "fib_retracement",
            lock: false,
            disableSelection: false,
            overrides: leg.isMuted
              ? { transparency: 85, linecolor: "rgba(120,120,120,0.4)" }
              : { transparency: 70 },
          });
          drawn += 1;
        } catch {}
      }

      if (preferredZone) {
        const zoneFrom = Math.round(nowSec + chartUtcOffset - 3 * 86400);
        const zoneTo = Math.round(nowSec + chartUtcOffset + 10 * 86400);
        try {
          chart.createMultipointShape(
            [
              { time: zoneFrom, price: preferredZone.high },
              { time: zoneTo, price: preferredZone.low },
            ],
            {
              shape: "rectangle",
              lock: false,
              disableSelection: false,
              overrides: { fillBackground: true, transparency: 85 },
            },
          );
        } catch {}
      }

      return { ok: drawn > 0, drawn, total: legs.length, chartUtcOffset };
    },
    { legs, preferredZone, isShort: direction === "short" },
  ).catch((err) => ({ ok: false, reason: String(err), drawn: 0, total: legs.length }));

  console.log("[fib-drawing-api][legacy] result:", result, { sessionId });
  return result.ok;
}

async function drawFibonacciWithChartApi(
  page: Page,
  sessionId: string,
  legs: FibonacciLegForBrowser[],
  preferredZone?: { low: number; high: number },
  direction?: "long" | "short",
): Promise<boolean> {
  let chartFrame: ReturnType<typeof getChartFrame>;
  try {
    chartFrame = getChartFrame(page);
  } catch (err) {
    console.error("[fib-drawing-api] chart frame not found:", err);
    return false;
  }

  const widgetCheck = await chartFrame.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    return {
      hasGildoreWidget: Boolean(w.__gildoreWidget),
      hasTVNamespace: Boolean(w.TradingView),
    };
  }).catch(() => ({ hasGildoreWidget: false, hasTVNamespace: false }));
  console.log("[fib-drawing-api] widget check:", widgetCheck);

  const result = await chartFrame.evaluate(
    ({ legs, preferredZone, isShort }: {
      legs: FibonacciLegForBrowser[];
      preferredZone?: { low: number; high: number };
      isShort: boolean;
    }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      let widget = w.__gildoreWidget;

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
          } catch { /* skip */ }
        }
      }

      if (!widget) return { ok: false, reason: "widget not found in iframe" };

      let chart: ReturnType<typeof widget.activeChart>;
      try { chart = widget.activeChart(); } catch (e) {
        return { ok: false, reason: "activeChart() failed: " + String(e) };
      }

      const convertFeedTimeToChartTime = (feedTime: number) => {
        const roundedFeedTime = Math.round(feedTime);

        try {
          if (typeof chart.endOfPeriodToBarTime === "function") {
            const converted = chart.endOfPeriodToBarTime(roundedFeedTime);
            if (typeof converted === "number" && Number.isFinite(converted)) {
              return Math.round(converted);
            }
          }
        } catch {}

        try {
          if (typeof chart.barTimeToEndOfPeriod === "function") {
            const endOfPeriod = chart.barTimeToEndOfPeriod(roundedFeedTime);
            if (typeof endOfPeriod === "number" && Number.isFinite(endOfPeriod)) {
              const maybeBarTime =
                typeof chart.endOfPeriodToBarTime === "function"
                  ? chart.endOfPeriodToBarTime(endOfPeriod)
                  : null;
              if (typeof maybeBarTime === "number" && Number.isFinite(maybeBarTime)) {
                return Math.round(maybeBarTime);
              }
            }
          }
        } catch {}

        return roundedFeedTime;
      };

      const earliest = Math.min(...legs.map((l) => l.lowTimeSec));
      const latest = Math.max(...legs.map((l) => l.highTimeSec));
      const rangeFrom = convertFeedTimeToChartTime(earliest - 15 * 86400);
      const rangeTo = convertFeedTimeToChartTime(latest + 7 * 86400);
      try {
        chart.setVisibleRange({ from: rangeFrom, to: rangeTo });
      } catch { /* non-fatal */ }
      const normalizedRange = chart.getVisibleRange() as { from: number; to: number } | null;

      // Clear any previous shapes
      try { chart.removeAllShapes(); } catch { /* non-fatal */ }

      let drawn = 0;
      const conversions: Array<{ feedLowTime: number; chartLowTime: number; feedHighTime: number; chartHighTime: number }> = [];
      for (const leg of legs) {
        const lowTime = convertFeedTimeToChartTime(leg.lowTimeSec);
        const highTime = convertFeedTimeToChartTime(leg.highTimeSec);
        conversions.push({
          feedLowTime: leg.lowTimeSec,
          chartLowTime: lowTime,
          feedHighTime: leg.highTimeSec,
          chartHighTime: highTime,
        });

        const points = isShort
          ? [{ time: lowTime, price: leg.highPrice }, { time: highTime, price: leg.lowPrice }]
          : [{ time: lowTime, price: leg.lowPrice }, { time: highTime, price: leg.highPrice }];

        try {
          chart.createMultipointShape(
            points,
            {
              shape: "fib_retracement",
              lock: false,
              disableSelection: false,
              overrides: leg.isMuted
                ? { transparency: 85, linecolor: "rgba(120,120,120,0.4)" }
                : { transparency: 70 },
            },
          );
          drawn += 1;
        } catch (e) {
          console.warn("[fib-drawing-api] createMultipointShape failed for leg:", e);
        }
      }

      // Draw the preferred reaction zone as a rectangle spanning now - 3 days → now + 10 days
      if (preferredZone) {
        const zoneAnchor = convertFeedTimeToChartTime(latest);
        const zoneFrom = Math.round(zoneAnchor - 3 * 86400);
        const zoneTo   = Math.round(zoneAnchor + 10 * 86400);
        try {
          chart.createMultipointShape(
            [
              { time: zoneFrom, price: preferredZone.high },
              { time: zoneTo,   price: preferredZone.low },
            ],
            {
              shape: "rectangle",
              lock: false,
              disableSelection: false,
              overrides: { fillBackground: true, transparency: 85 },
            },
          );
        } catch (e) {
          console.warn("[fib-drawing-api] zone rectangle failed:", e);
        }
      }

      return {
        ok: drawn > 0,
        drawn,
        total: legs.length,
        exactTimeMode: true,
        conversions,
        normalizedRange,
        rangeFrom,
        rangeTo,
      };
    },
    { legs, preferredZone, isShort: direction === "short" },
  ).catch((err) => ({ ok: false, reason: String(err), drawn: 0, total: legs.length }));

  console.log("[fib-drawing-api] result:", result, { sessionId });
  return result.ok;
}

export async function startFibonacciBrowserSession(args: {
  sessionId: string;
  agentSlug: string;
  marketSymbol: string;
  timeframe: string;
  targetUrl: string;
  legs: FibonacciLegForBrowser[];
  preferredZone?: { low: number; high: number };
  direction?: "long" | "short";
}) {
  const existing = runtimeSessions.get(args.sessionId);
  if (existing) {
    return { ok: true, screenshotPath: existing.screenshotPath, reused: true };
  }

  console.log("[fib-browser-session] boot requested", {
    sessionId: args.sessionId,
    agentSlug: args.agentSlug,
    marketSymbol: args.marketSymbol,
    timeframe: args.timeframe,
    legCount: args.legs.length,
  });

  await ensureScreenshotDir();
  const screenshotPath = screenshotPathFor(args.sessionId);
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  attachFibonacciBrowserApiProbe(page);
  attachFibonacciNetworkProbe(args.sessionId, page);

  // Intercept the TradingView widget constructor (same init script as the main session)
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
                    console.log('[gildore] TradingView widget captured (fib)');
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
    await writeStepState({ sessionId: args.sessionId, steps, currentIndex: 1, currentStatus: "loading_chart" });
    await page.goto(args.targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3000);
    await capture(args.sessionId);

    await writeStepState({ sessionId: args.sessionId, steps, currentIndex: 2, currentStatus: "switching_symbol" });
    await switchDerivSymbol(args.sessionId, page, args.marketSymbol);
    await capture(args.sessionId);

    await writeStepState({ sessionId: args.sessionId, steps, currentIndex: 3, currentStatus: "switching_timeframe" });
    await switchDerivTimeframe(args.sessionId, page, args.timeframe);
    await capture(args.sessionId);

    // Wait for chart to fully settle before drawing
    await page.waitForTimeout(2000);
    await inspectFibonacciChartInternals(args.sessionId, page);
    await autoScaleYAxis(page);
    await page.waitForTimeout(500);

    if (args.legs.length > 0) {
      setActionLabel(args.sessionId, "Drawing fibonacci retracements via chart API");
      const granularity = timeframeToDerivGranularity(args.timeframe);
      const derivSnapshot = await collectDerivHistorySnapshot(
        args.sessionId,
        page,
        granularity,
      );
      const derivCandles = derivSnapshot ? mergeDerivCandles(derivSnapshot) : [];
      console.log("[fib-resolve] deriv snapshot", {
        sessionId: args.sessionId,
        symbol: derivSnapshot?.symbol ?? null,
        granularity,
        candleCount: derivCandles.length,
        latestOhlcOpenTime: derivSnapshot?.latestOhlc?.open_time ?? null,
      });

      const resolvedLegs =
        derivCandles.length > 0
          ? resolveFibonacciLegsToDerivCandles({
              legs: args.legs,
              candles: derivCandles,
              direction: args.direction,
              granularity,
            })
          : null;

      if (resolvedLegs) {
        console.log("[fib-resolve] resolved legs", {
          sessionId: args.sessionId,
          original: args.legs.map((leg) => ({
            lowTimeSec: leg.lowTimeSec,
            lowPrice: leg.lowPrice,
            highTimeSec: leg.highTimeSec,
            highPrice: leg.highPrice,
          })),
          resolved: resolvedLegs.map((leg) => ({
            lowTimeSec: leg.lowTimeSec,
            lowPrice: leg.lowPrice,
            highTimeSec: leg.highTimeSec,
            highPrice: leg.highPrice,
          })),
        });
      } else {
        console.warn("[fib-resolve] failed to resolve deriv anchors, falling back", {
          sessionId: args.sessionId,
          granularity,
          candleCount: derivCandles.length,
        });
      }

      let drawLegs = resolvedLegs ?? args.legs;
      let drawn = resolvedLegs
        ? await drawFibonacciWithChartApi(
            page,
            args.sessionId,
            drawLegs,
            args.preferredZone,
            args.direction,
          )
        : await drawFibonacciWithChartApiLegacy(
            page,
            args.sessionId,
            drawLegs,
            args.preferredZone,
            args.direction,
          );
      console.log("[fib-browser-session] fibonacci draw result:", { drawn, sessionId: args.sessionId });
      await page.waitForTimeout(1200);

      if (drawn && resolvedLegs && granularity > 0) {
        const MAX_FIB_ADJUSTMENT_PASSES = 3;
        let cumulativeShiftBars = 0;

        for (let pass = 0; pass < MAX_FIB_ADJUSTMENT_PASSES; pass += 1) {
          const activeLeg = drawLegs.find((l) => !l.isMuted);
          if (!activeLeg) break;

          setActionLabel(args.sessionId, `Measuring fibonacci placement (${pass + 1}/${MAX_FIB_ADJUSTMENT_PASSES})`);
          const adjustBuf = await captureToBuffer(page);
          const estimate = await estimateFibonacciPlacementError(adjustBuf, {
            direction: args.direction ?? "long",
            timeframe: args.timeframe,
            granularitySec: granularity,
            activeLeg: {
              lowTimeSec: activeLeg.lowTimeSec,
              lowPrice: activeLeg.lowPrice,
              highTimeSec: activeLeg.highTimeSec,
              highPrice: activeLeg.highPrice,
            },
          });
          console.log("[fib-adjust] estimate", {
            sessionId: args.sessionId,
            pass: pass + 1,
            cumulativeShiftBars,
            estimate,
          });

          const converged =
            estimate.anchorCycle === "intended_latest_swing" &&
            Math.abs(estimate.averageBarError) <= 1 &&
            Math.abs(estimate.leftAnchorBarError) <= 2 &&
            Math.abs(estimate.rightAnchorBarError) <= 2;
          if (converged) {
            console.log("[fib-adjust] converged", {
              sessionId: args.sessionId,
              pass: pass + 1,
              cumulativeShiftBars,
              estimate,
            });
            break;
          }

          const shouldAdjust =
            estimate.shouldAdjust &&
            estimate.confidence >= 0.45 &&
            (
              estimate.anchorCycle === "older_left_swing" ||
              Math.abs(estimate.averageBarError) >= 3
            );
          if (!shouldAdjust) {
            break;
          }

          const shiftBars = Math.max(-96, Math.min(96, estimate.averageBarError));
          cumulativeShiftBars += shiftBars;
          drawLegs = shiftFibonacciLegsByBars(resolvedLegs, cumulativeShiftBars, granularity);

          setActionLabel(args.sessionId, `Redrawing fibonacci (${shiftBars > 0 ? "+" : ""}${shiftBars} bars)`);
          drawn = await drawFibonacciWithChartApi(
            page,
            args.sessionId,
            drawLegs,
            args.preferredZone,
            args.direction,
          );
          console.log("[fib-adjust] redraw result", {
            sessionId: args.sessionId,
            pass: pass + 1,
            shiftBars,
            cumulativeShiftBars,
            drawn,
          });
          await page.waitForTimeout(1200);
          if (!drawn) break;
        }
      }

      // Vision revalidation: quick Haiku pass to confirm the drawing looks correct
      const activeLeg = drawLegs.find((l) => !l.isMuted);
      if (drawn && activeLeg) {
        setActionLabel(args.sessionId, "Revalidating structure with vision agent");
        const verifyBuf = await captureToBuffer(page);
        const verification = await verifyFibonacciDrawing(verifyBuf, {
          direction: args.direction ?? "long",
          activeLeg: { lowPrice: activeLeg.lowPrice, highPrice: activeLeg.highPrice },
          preferredZone: args.preferredZone,
        });
        console.log("[fib-browser-session] vision verification:", verification);
        const runtime = runtimeSessions.get(args.sessionId);
        if (runtime) {
          runtime.visionDecision = {
            regime: args.direction === "short" ? "bearish" : "bullish",
            verdict: verification.confirmed ? "valid" : "staged",
            direction: args.direction ?? "long",
            structureStatus: verification.structureIntact ? "clean" : "weak",
            confidence: verification.confirmed ? 0.82 : 0.55,
            rationale: verification.note,
            issues: verification.confirmed ? [] : ["Fibonacci drawing may need review"],
          };
        }
        await capture(args.sessionId);
      }
    }

    await capture(args.sessionId);

    await writeStepState({ sessionId: args.sessionId, steps, currentIndex: 4, currentStatus: "ready" });
    await capture(args.sessionId);
    setActionLabel(args.sessionId, undefined);

    console.log("[fib-browser-session] session ready", { sessionId: args.sessionId });
    return { ok: true, screenshotPath, reused: false };
  } catch (error) {
    console.error("[fib-browser-session] startup failed", {
      sessionId: args.sessionId,
      error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
    });
    await writeStepState({
      sessionId: args.sessionId,
      steps,
      currentIndex: Math.min(steps.length, 3),
      currentStatus: "failed",
      error: error instanceof Error ? error.message : "fib_browser_session_failed",
    });
    try { await capture(args.sessionId); } catch {}
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
