import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { startControlledBrowserSession, type SwingPointsForBrowser } from "@/lib/browser-session-runtime";
import type { TradeTimeframe } from "@/lib/arena-types";
import { fetchPythHistory } from "@/lib/pyth-history";
import { deriveThirdTouchArenaState } from "@/lib/third-touch-engine";

const CANDLE_SECONDS: Record<string, number> = {
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
};

function isTradeTimeframe(value: string): value is TradeTimeframe {
  return value === "15m" || value === "1h" || value === "4h";
}

function getConvexClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured.");
  }

  return new ConvexHttpClient(url);
}

function extractSwingPointsFromTrace(
  trace: {
    annotations?: Array<{
      geometry?: {
        kind?: string;
        text?: string;
        position?: { price?: number; timeSec?: number };
        end?: { price?: number; timeSec?: number };
        lowPrice?: number;
        highPrice?: number;
      };
    }>;
  } | undefined,
  timeframe: string,
): SwingPointsForBrowser | undefined {
  if (!trace?.annotations) return undefined;

  let t1Price: number | undefined;
  let t1TimeSec: number | undefined;
  let t2Price: number | undefined;
  let t2TimeSec: number | undefined;
  let projectedPrice: number | undefined;
  let t3TimeSec: number | undefined;
  let zoneLow: number | undefined;
  let zoneHigh: number | undefined;

  for (const annotation of trace.annotations) {
    const g = annotation.geometry;
    if (!g) continue;
    if (g.kind === "marker" && g.text === "T1") {
      t1Price = g.position?.price;
      t1TimeSec = g.position?.timeSec;
    }
    if (g.kind === "marker" && g.text === "T2") {
      t2Price = g.position?.price;
      t2TimeSec = g.position?.timeSec;
    }
    if (g.kind === "line") {
      projectedPrice = g.end?.price;
      t3TimeSec = g.end?.timeSec;
    }
    if (g.kind === "zone") {
      zoneLow = g.lowPrice;
      zoneHigh = g.highPrice;
    }
  }

  if (
    t1Price === undefined ||
    t2Price === undefined ||
    projectedPrice === undefined ||
    zoneLow === undefined ||
    zoneHigh === undefined
  ) {
    return undefined;
  }

  const allPrices = [t1Price, t2Price, projectedPrice, zoneLow, zoneHigh];
  const rawLow = Math.min(...allPrices);
  const rawHigh = Math.max(...allPrices);
  const padding = (rawHigh - rawLow) * 0.2;

  return {
    t1Price,
    t1TimeSec,
    t2Price,
    t2TimeSec,
    projectedPrice,
    t3TimeSec,
    zoneLow,
    zoneHigh,
    direction: t2Price > t1Price ? "long" : "short",
    visiblePriceLow: rawLow - padding,
    visiblePriceHigh: rawHigh + padding,
    candleSeconds: CANDLE_SECONDS[timeframe] ?? 3600,
  };
}

export async function POST(request: Request) {
  let sessionId: string | undefined;

  try {
    const body = (await request.json()) as {
      sessionId: string;
      agentSlug: string;
      agentMarketSymbol: string;
      marketSymbol: string;
      timeframe: string;
      targetUrl: string;
      swingPoints?: SwingPointsForBrowser;
    };
    sessionId = body.sessionId;
    console.log("[browser-session/start] request received", {
      sessionId: body.sessionId,
      agentSlug: body.agentSlug,
      agentMarketSymbol: body.agentMarketSymbol,
      marketSymbol: body.marketSymbol,
      timeframe: body.timeframe,
      targetUrl: body.targetUrl,
      hasSwingPoints: Boolean(body.swingPoints),
    });

    if (!body.sessionId || !body.marketSymbol || !body.timeframe || !body.targetUrl) {
      console.error("[browser-session/start] missing required fields", {
        sessionId: body.sessionId,
        marketSymbol: body.marketSymbol,
        timeframe: body.timeframe,
        targetUrl: body.targetUrl,
      });
      return NextResponse.json(
        { ok: false, error: "missing_required_fields" },
        { status: 400 },
      );
    }

    let swingPoints = body.swingPoints;
    if (!swingPoints && body.agentSlug === "third-touch") {
      try {
        const convex = getConvexClient();
        const snapshot = await convex.query(api.arena.getArenaSnapshot, {});
        const trace = snapshot.visualTraces.find(
          (item: { agentSlug: string; marketSymbol: string }) =>
            item.agentSlug === body.agentSlug &&
            item.marketSymbol === body.agentMarketSymbol,
        );
        swingPoints = extractSwingPointsFromTrace(trace, body.timeframe);
        console.log("[browser-session/start] server-side swingPoints fallback", {
          sessionId: body.sessionId,
          agentSlug: body.agentSlug,
          marketSymbol: body.agentMarketSymbol,
          traceFound: Boolean(trace),
          annotationCount: trace?.annotations?.length ?? 0,
          recovered: Boolean(swingPoints),
        });

        if (!swingPoints && isTradeTimeframe(body.timeframe)) {
          const candles = await fetchPythHistory(
            body.agentMarketSymbol,
            body.timeframe,
          );
          const derived = candles
            ? deriveThirdTouchArenaState({
                agentId: body.agentSlug,
                marketSymbol: body.agentMarketSymbol,
                timeframe: body.timeframe,
                candles,
              })
            : null;
          swingPoints = extractSwingPointsFromTrace(derived?.trace, body.timeframe);

          console.log("[browser-session/start] on-demand third-touch fallback", {
            sessionId: body.sessionId,
            marketSymbol: body.agentMarketSymbol,
            candleCount: candles?.length ?? 0,
            derived: Boolean(derived),
            recovered: Boolean(swingPoints),
          });
        }
      } catch (fallbackError) {
        console.warn("[browser-session/start] swingPoints fallback failed", {
          sessionId: body.sessionId,
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        });
      }
    }

    console.log("[browser-session/start] starting controlled browser session", {
      sessionId: body.sessionId,
      marketSymbol: body.marketSymbol,
      hasSwingPoints: Boolean(swingPoints),
    });
    const result = await startControlledBrowserSession({
      sessionId: body.sessionId,
      agentSlug: body.agentSlug,
      agentMarketSymbol: body.agentMarketSymbol,
      marketSymbol: body.marketSymbol,
      timeframe: body.timeframe,
      targetUrl: body.targetUrl,
      swingPoints,
    });

    console.log("[browser-session/start] controlled browser session completed", {
      sessionId: body.sessionId,
      ok: result.ok,
      reused: result.reused,
      screenshotPath: result.screenshotPath,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[browser-session/start] route failed", {
      sessionId,
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name,
      } : error,
    });

    if (sessionId) {
      try {
        const convex = getConvexClient();
        await convex.mutation(api.arena.updateBrowserSessionState, {
          sessionId: sessionId as never,
          status: "failed",
          currentStepLabel: "Browser startup failed",
          currentStepIndex: 1,
          error: error instanceof Error ? error.message : "browser_session_failed",
        });
        console.log("[browser-session/start] marked browser session failed in Convex", {
          sessionId,
        });
      } catch {}
    }

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "browser_session_failed",
      },
      { status: 500 },
    );
  }
}
