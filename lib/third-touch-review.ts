import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { TradeTimeframe } from "@/lib/arena-types";
import {
  type SwingPointsForBrowser,
  timeframeToDerivGranularity,
} from "@/lib/browser-session-runtime";
import { fetchPythHistory } from "@/lib/pyth-history";
import { deriveThirdTouchArenaState } from "@/lib/third-touch-engine";

const CANDLE_SECONDS: Record<TradeTimeframe, number> = {
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
};

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
  timeframe: TradeTimeframe,
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
    const geometry = annotation.geometry;
    if (!geometry) continue;

    if (geometry.kind === "marker" && geometry.text === "T1") {
      t1Price = geometry.position?.price;
      t1TimeSec = geometry.position?.timeSec;
    }

    if (geometry.kind === "marker" && geometry.text === "T2") {
      t2Price = geometry.position?.price;
      t2TimeSec = geometry.position?.timeSec;
    }

    if (geometry.kind === "line") {
      projectedPrice = geometry.end?.price;
      t3TimeSec = geometry.end?.timeSec;
    }

    if (geometry.kind === "zone") {
      zoneLow = geometry.lowPrice;
      zoneHigh = geometry.highPrice;
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
    candleSeconds: CANDLE_SECONDS[timeframe] ?? timeframeToDerivGranularity(timeframe),
  };
}

export async function resolveThirdTouchSwingPoints(args: {
  convex: ConvexHttpClient;
  agentSlug: string;
  marketSymbol: string;
  timeframe: TradeTimeframe;
}) {
  const snapshot = await args.convex.query(api.arena.getArenaSnapshot, {});
  const trace = snapshot.visualTraces.find(
    (item: { agentSlug: string; marketSymbol: string }) =>
      item.agentSlug === args.agentSlug &&
      item.marketSymbol === args.marketSymbol,
  );
  const fromTrace = extractSwingPointsFromTrace(trace, args.timeframe);

  if (fromTrace) {
    return {
      swingPoints: fromTrace,
      recoveredFrom: "trace" as const,
      annotationCount: trace?.annotations?.length ?? 0,
      candleCount: 0,
    };
  }

  const candles = await fetchPythHistory(args.marketSymbol, args.timeframe);
  const derived = candles
    ? deriveThirdTouchArenaState({
        agentId: args.agentSlug,
        marketSymbol: args.marketSymbol,
        timeframe: args.timeframe,
        candles,
      })
    : null;
  const fromDerived = extractSwingPointsFromTrace(derived?.trace, args.timeframe);

  return {
    swingPoints: fromDerived,
    recoveredFrom: fromDerived ? ("derived" as const) : ("none" as const),
    annotationCount: trace?.annotations?.length ?? 0,
    candleCount: candles?.length ?? 0,
  };
}
