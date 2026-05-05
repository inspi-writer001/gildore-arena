import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import {
  startFibonacciBrowserSession,
  type FibonacciLegForBrowser,
} from "@/lib/browser-session-runtime";
import { deriveFibonacciArenaState } from "@/lib/fibonacci-engine";
import { fetchPythHistory } from "@/lib/pyth-history";
import type { TradeTimeframe } from "@/lib/arena-types";

function getConvexClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured.");
  return new ConvexHttpClient(url);
}

// When the dashboard has no cached trace yet, compute fibonacci legs on-the-fly
// from Pyth candle data so the browser session always has something to draw.
async function computeLegsFromPyth(
  agentSlug: string,
  marketSymbol: string,
  timeframe: string,
): Promise<{ legs: FibonacciLegForBrowser[]; preferredZone?: { low: number; high: number }; direction?: "long" | "short" }> {
  const validTimeframes: TradeTimeframe[] = ["15m", "1h", "4h"];
  const tf = validTimeframes.includes(timeframe as TradeTimeframe)
    ? (timeframe as TradeTimeframe)
    : "4h";

  const candles = await fetchPythHistory(marketSymbol, tf);
  if (!candles || candles.length < 30) {
    console.log("[fib-route] pyth fetch returned no usable candles", { marketSymbol, tf });
    return { legs: [] };
  }

  const derived = deriveFibonacciArenaState({
    agentId: agentSlug,
    marketSymbol,
    timeframe: tf,
    candles,
  });

  if (!derived) {
    console.log("[fib-route] engine returned null", { marketSymbol });
    return { legs: [] };
  }

  const legs: FibonacciLegForBrowser[] = [];
  let preferredZone: { low: number; high: number } | undefined;
  let direction: "long" | "short" | undefined;

  for (const annotation of derived.trace.annotations) {
    const g = annotation.geometry;
    if (!g) continue;
    if (g.kind === "fibonacci" && g.startTimeSec !== undefined && g.endTimeSec !== undefined) {
      legs.push({
        lowTimeSec: g.startTimeSec,
        lowPrice: g.lowPrice,
        highTimeSec: g.endTimeSec,
        highPrice: g.highPrice,
        isMuted: g.tone === "muted",
      });
    }
    if (g.kind === "zone" && g.tone === "zone") {
      preferredZone = { low: g.lowPrice, high: g.highPrice };
    }
  }

  direction = derived.tradeIdea.direction;

  console.log("[fib-route] computed legs on-the-fly", {
    marketSymbol,
    candleCount: candles.length,
    legCount: legs.length,
    preferredZone,
    direction,
  });

  return { legs, preferredZone, direction };
}

export async function POST(request: Request) {
  let sessionId: string | undefined;

  try {
    const body = (await request.json()) as {
      sessionId: string;
      agentSlug: string;
      agentMarketSymbol: string;  // the agent's actual market (e.g. XAU/USD)
      marketSymbol: string;        // the browser target (may differ on weekends)
      timeframe: string;
      targetUrl: string;
      legs: FibonacciLegForBrowser[];
      preferredZone?: { low: number; high: number };
      direction?: "long" | "short";
    };
    sessionId = body.sessionId;
    let { legs, preferredZone, direction } = {
      legs: body.legs ?? [],
      preferredZone: body.preferredZone,
      direction: body.direction,
    };

    console.log("[browser-session/fibonacci/start] request received", {
      sessionId: body.sessionId,
      agentSlug: body.agentSlug,
      agentMarketSymbol: body.agentMarketSymbol,
      browserMarketSymbol: body.marketSymbol,
      timeframe: body.timeframe,
      legCount: legs.length,
    });

    if (!body.sessionId || !body.marketSymbol || !body.timeframe || !body.targetUrl) {
      return NextResponse.json(
        { ok: false, error: "missing_required_fields" },
        { status: 400 },
      );
    }

    // No legs from dashboard trace — compute from Pyth for the browser target market.
    // We prefer the browser target market so prices match the visible chart.
    // Fall back to the agent's actual market if the browser target isn't on Pyth.
    if (legs.length === 0) {
      console.log("[browser-session/fibonacci/start] no legs from trace — computing from Pyth");
      const computed = await computeLegsFromPyth(body.agentSlug, body.marketSymbol, body.timeframe);
      if (computed.legs.length === 0 && body.agentMarketSymbol && body.agentMarketSymbol !== body.marketSymbol) {
        const fallback = await computeLegsFromPyth(body.agentSlug, body.agentMarketSymbol, body.timeframe);
        legs = fallback.legs;
        preferredZone = fallback.preferredZone ?? preferredZone;
        direction = fallback.direction ?? direction;
      } else {
        legs = computed.legs;
        preferredZone = computed.preferredZone ?? preferredZone;
        direction = computed.direction ?? direction;
      }
    }

    const result = await startFibonacciBrowserSession({
      sessionId: body.sessionId,
      agentSlug: body.agentSlug,
      marketSymbol: body.marketSymbol,
      timeframe: body.timeframe,
      targetUrl: body.targetUrl,
      legs,
      preferredZone,
      direction,
    });

    console.log("[browser-session/fibonacci/start] session completed", {
      sessionId: body.sessionId,
      ok: result.ok,
      reused: result.reused,
      legCount: legs.length,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[browser-session/fibonacci/start] route failed", {
      sessionId,
      error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
    });

    if (sessionId) {
      try {
        const convex = getConvexClient();
        await convex.mutation(api.arena.updateBrowserSessionState, {
          sessionId: sessionId as never,
          status: "failed",
          currentStepLabel: "Fibonacci browser startup failed",
          currentStepIndex: 1,
          error: error instanceof Error ? error.message : "fib_browser_session_failed",
        });
      } catch {}
    }

    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "fib_browser_session_failed" },
      { status: 500 },
    );
  }
}
