import { NextResponse } from "next/server";
import {
  startControlledBrowserSession,
  timeframeToDerivGranularity,
  type CachedBrowserOverlay,
  type SwingPointsForBrowser,
} from "@/lib/browser-session-runtime";
import type { TradeTimeframe } from "@/lib/arena-types";

function parseAnchorDateToMidday(date: string | undefined) {
  if (!date) return undefined;
  const timestamp = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.round(timestamp / 1000);
}

function isTradeTimeframe(value: string): value is TradeTimeframe {
  return value === "15m" || value === "1h" || value === "4h";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      sessionId: string;
      agentSlug: string;
      agentMarketSymbol: string;
      marketSymbol: string;
      timeframe: TradeTimeframe;
      targetUrl: string;
      overlay: {
        structureStatus: CachedBrowserOverlay["structureStatus"];
        verdict: CachedBrowserOverlay["verdict"];
        direction: CachedBrowserOverlay["direction"];
        t1Price?: number;
        t1Date?: string;
        t2Price?: number;
        t2Date?: string;
        zoneLow?: number;
        zoneHigh?: number;
        projectedPrice?: number;
        invalidationLow?: number;
        invalidationHigh?: number;
        invalidationNote?: string;
      };
    };

    if (
      !body.sessionId ||
      !body.agentSlug ||
      !body.marketSymbol ||
      !body.targetUrl ||
      !isTradeTimeframe(body.timeframe)
    ) {
      return NextResponse.json(
        { ok: false, error: "missing_required_fields" },
        { status: 400 },
      );
    }

    const {
      t1Price,
      t1Date,
      t2Price,
      t2Date,
      zoneLow,
      zoneHigh,
      projectedPrice,
      invalidationLow,
      invalidationHigh,
      invalidationNote,
      structureStatus,
      verdict,
      direction,
    } = body.overlay;

    if (
      t1Price === undefined ||
      t2Price === undefined ||
      zoneLow === undefined ||
      zoneHigh === undefined ||
      projectedPrice === undefined ||
      direction === "none"
    ) {
      return NextResponse.json(
        { ok: false, error: "cached_overlay_incomplete" },
        { status: 400 },
      );
    }

    const t1TimeSec = parseAnchorDateToMidday(t1Date);
    const t2TimeSec = parseAnchorDateToMidday(t2Date);
    const t3TimeSec = Math.round(Date.now() / 1000);
    const allPrices = [t1Price, t2Price, zoneLow, zoneHigh, projectedPrice];
    const rawLow = Math.min(...allPrices);
    const rawHigh = Math.max(...allPrices);
    const padding = Math.max((rawHigh - rawLow) * 0.25, rawHigh * 0.004);

    const swingPoints: SwingPointsForBrowser = {
      t1Price,
      t1TimeSec,
      t2Price,
      t2TimeSec,
      projectedPrice,
      t3TimeSec,
      zoneLow,
      zoneHigh,
      direction,
      visiblePriceLow: rawLow - padding,
      visiblePriceHigh: rawHigh + padding,
      candleSeconds: timeframeToDerivGranularity(body.timeframe),
    };

    const result = await startControlledBrowserSession({
      sessionId: body.sessionId,
      agentSlug: body.agentSlug,
      agentMarketSymbol: body.agentMarketSymbol,
      marketSymbol: body.marketSymbol,
      timeframe: body.timeframe,
      targetUrl: body.targetUrl,
      swingPoints,
      cachedOverlay: {
        structureStatus,
        verdict,
        direction,
        t1Date,
        t2Date,
        invalidationZone:
          invalidationLow !== undefined &&
          invalidationHigh !== undefined &&
          invalidationNote
            ? {
                low: invalidationLow,
                high: invalidationHigh,
                note: invalidationNote,
              }
            : undefined,
        invalidationNote,
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "cached_render_failed",
      },
      { status: 500 },
    );
  }
}
