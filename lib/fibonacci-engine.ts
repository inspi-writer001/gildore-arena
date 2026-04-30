import type {
  ConfluenceState,
  Position,
  TradeEvent,
  TradeIdea,
  TradeTimeframe,
  VisualAnnotation,
  VisualTrace,
  WatchlistItem,
} from "./arena-types";
import type { PythCandle } from "./pyth-history";

type FibonacciEngineInput = {
  agentId: string;
  marketSymbol: string;
  timeframe: TradeTimeframe;
  candles: PythCandle[];
  newsState?: ConfluenceState;
};

type FibonacciEngineOutput = {
  tradeIdea: TradeIdea;
  trace: VisualTrace;
  events: TradeEvent[];
  watchlistItem: WatchlistItem;
  position?: Position;
};

type Pivot = {
  index: number;
  time: number;
  price: number;
  kind: "high" | "low";
};

type BullishLeg = {
  lowPivot: Pivot;
  highPivot: Pivot;
  retracementPivot?: Pivot;
  range: number;
  retracementRatio?: number;
};

type ConfirmationSignal = {
  confirmed: boolean;
  label: string;
  candleIndex: number;
};

const PRIMARY_LEVELS = [0.5, 0.618, 0.7] as const;
const RENDER_LEVELS = [0, 0.5, 0.618, 0.7, 0.786, 1];

function roundForMarket(marketSymbol: string, value: number) {
  const decimals = marketSymbol === "EUR/USD" ? 4 : 2;
  return Number(value.toFixed(decimals));
}

function formatEventLabel(timeSec: number) {
  return new Date(timeSec * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function fibPrice(leg: BullishLeg, level: number) {
  return leg.highPivot.price - leg.range * level;
}

function candleOverlapsZone(candle: PythCandle, low: number, high: number) {
  return candle.low <= high && candle.high >= low;
}

function candleBodySize(candle: PythCandle) {
  return Math.abs(candle.close - candle.open);
}

function isBullishCandle(candle: PythCandle) {
  return candle.close > candle.open;
}

function isBearishCandle(candle: PythCandle) {
  return candle.close < candle.open;
}

function lowerWick(candle: PythCandle) {
  return Math.min(candle.open, candle.close) - candle.low;
}

function upperWick(candle: PythCandle) {
  return candle.high - Math.max(candle.open, candle.close);
}

function isDoji(candle: PythCandle) {
  const range = candle.high - candle.low;
  if (range <= 0) return false;
  return candleBodySize(candle) / range <= 0.2;
}

function detectBullishConfirmation(
  candles: PythCandle[],
  zoneLow: number,
  zoneHigh: number,
): ConfirmationSignal {
  const latestIndex = candles.length - 1;
  const latest = candles[latestIndex];
  const previous = candles[latestIndex - 1];

  if (!latest || !previous) {
    return { confirmed: false, label: "Waiting for trigger", candleIndex: latestIndex };
  }

  const latestInZone = candleOverlapsZone(latest, zoneLow, zoneHigh);
  const previousInZone = candleOverlapsZone(previous, zoneLow, zoneHigh);

  const latestHammer =
    latestInZone &&
    isBullishCandle(latest) &&
    lowerWick(latest) >= candleBodySize(latest) * 2 &&
    upperWick(latest) <= candleBodySize(latest) * 1.25;

  if (latestHammer) {
    return {
      confirmed: true,
      label: "Hammer confirmation inside the reaction band",
      candleIndex: latestIndex,
    };
  }

  const bullishEngulfing =
    previousInZone &&
    isBearishCandle(previous) &&
    isBullishCandle(latest) &&
    latest.close >= previous.open &&
    latest.open <= previous.close;

  if (bullishEngulfing) {
    return {
      confirmed: true,
      label: "Bullish engulfing reclaimed the retracement zone",
      candleIndex: latestIndex,
    };
  }

  const dojiReclaim =
    previousInZone &&
    isDoji(previous) &&
    isBullishCandle(latest) &&
    latest.close > previous.high;

  if (dojiReclaim) {
    return {
      confirmed: true,
      label: "Doji hesitation resolved into a bullish reclaim",
      candleIndex: latestIndex,
    };
  }

  const momentumReclaim =
    (latestInZone || previousInZone) &&
    isBullishCandle(latest) &&
    latest.close > previous.high;

  if (momentumReclaim) {
    return {
      confirmed: true,
      label: "Momentum reclaim closed above the prior candle high",
      candleIndex: latestIndex,
    };
  }

  return {
    confirmed: false,
    label: "Price is inside the reaction band but confirmation has not closed yet",
    candleIndex: latestIndex,
  };
}

function detectBearishConfirmation(
  candles: PythCandle[],
  zoneLow: number,
  zoneHigh: number,
): ConfirmationSignal {
  const latestIndex = candles.length - 1;
  const latest = candles[latestIndex];
  const previous = candles[latestIndex - 1];

  if (!latest || !previous) {
    return { confirmed: false, label: "Waiting for trigger", candleIndex: latestIndex };
  }

  const latestInZone = candleOverlapsZone(latest, zoneLow, zoneHigh);
  const previousInZone = candleOverlapsZone(previous, zoneLow, zoneHigh);

  const shootingStar =
    latestInZone &&
    isBearishCandle(latest) &&
    upperWick(latest) >= candleBodySize(latest) * 2 &&
    lowerWick(latest) <= candleBodySize(latest) * 1.25;

  if (shootingStar) {
    return { confirmed: true, label: "Shooting star rejection from the reaction band", candleIndex: latestIndex };
  }

  const bearishEngulfing =
    previousInZone &&
    isBullishCandle(previous) &&
    isBearishCandle(latest) &&
    latest.close <= previous.open &&
    latest.open >= previous.close;

  if (bearishEngulfing) {
    return { confirmed: true, label: "Bearish engulfing from the retracement zone", candleIndex: latestIndex };
  }

  const dojiRejection =
    previousInZone &&
    isDoji(previous) &&
    isBearishCandle(latest) &&
    latest.close < previous.low;

  if (dojiRejection) {
    return { confirmed: true, label: "Doji hesitation resolved into a bearish rejection", candleIndex: latestIndex };
  }

  const momentumBreak =
    (latestInZone || previousInZone) &&
    isBearishCandle(latest) &&
    latest.close < previous.low;

  if (momentumBreak) {
    return { confirmed: true, label: "Momentum break closed below the prior candle low", candleIndex: latestIndex };
  }

  return { confirmed: false, label: "Price is inside the reaction band but bearish confirmation has not closed yet", candleIndex: latestIndex };
}

function buildBearishLegs(window: PythCandle[]) {
  const { lows, highs } = findPivots(window);
  if (lows.length === 0 || highs.length === 0) return [];

  const averageRange = averageTrueRange(window);
  const minimumLegRange = averageRange * 6;
  const legs: BullishLeg[] = [];

  for (let index = 0; index < highs.length; index += 1) {
    const highPivot = highs[index];
    const nextHighPivot = highs[index + 1];
    if (!highPivot) continue;

    const candidateLows = lows.filter(
      (pivot) =>
        pivot.index > highPivot.index + 2 &&
        pivot.index < (nextHighPivot?.index ?? window.length),
    );

    if (candidateLows.length === 0) continue;

    const lowPivot = candidateLows.reduce((best, pivot) =>
      pivot.price < best.price ? pivot : best,
    );

    const range = highPivot.price - lowPivot.price;
    if (range <= minimumLegRange) continue;

    // retracementPivot = the next high (bounce after the low), must be lower than current high
    const retracementPivot = nextHighPivot && nextHighPivot.price < highPivot.price ? nextHighPivot : undefined;
    const retracementRatio = retracementPivot
      ? clamp((retracementPivot.price - lowPivot.price) / range, 0, 1.5)
      : undefined;

    legs.push({ lowPivot, highPivot, retracementPivot, range, retracementRatio });
  }

  return legs;
}

function detectTrend(candles: PythCandle[]): "bullish" | "bearish" {
  const slice = Math.max(5, Math.floor(candles.length * 0.15));
  const firstAvg = candles.slice(0, slice).reduce((s, c) => s + c.close, 0) / slice;
  const lastAvg = candles.slice(-slice).reduce((s, c) => s + c.close, 0) / slice;
  return lastAvg >= firstAvg ? "bullish" : "bearish";
}

function resolveWindowSize(timeframe: TradeTimeframe) {
  switch (timeframe) {
    case "15m":
      return 144;
    case "1h":
      return 120;
    case "4h":
      return 96;
    default:
      return 120;
  }
}

function findPivots(window: PythCandle[], strength = 2) {
  const lows: Pivot[] = [];
  const highs: Pivot[] = [];

  for (let index = strength; index < window.length - strength; index += 1) {
    const candle = window[index];
    if (!candle) continue;

    let isPivotLow = true;
    let isPivotHigh = true;

    for (let offset = 1; offset <= strength; offset += 1) {
      const left = window[index - offset];
      const right = window[index + offset];
      if (!left || !right) {
        isPivotLow = false;
        isPivotHigh = false;
        break;
      }

      if (candle.low > left.low || candle.low > right.low) {
        isPivotLow = false;
      }

      if (candle.high < left.high || candle.high < right.high) {
        isPivotHigh = false;
      }
    }

    if (isPivotLow) {
      lows.push({
        index,
        time: candle.time,
        price: candle.low,
        kind: "low",
      });
    }

    if (isPivotHigh) {
      highs.push({
        index,
        time: candle.time,
        price: candle.high,
        kind: "high",
      });
    }
  }

  return { lows, highs };
}

function averageTrueRange(window: PythCandle[]) {
  if (window.length === 0) return 0;
  return (
    window.reduce((total, candle) => total + (candle.high - candle.low), 0) /
    window.length
  );
}

function buildBullishLegs(window: PythCandle[]) {
  const { lows, highs } = findPivots(window);
  if (lows.length === 0 || highs.length === 0) return [];

  const averageRange = averageTrueRange(window);
  const minimumLegRange = averageRange * 6;
  const legs: BullishLeg[] = [];

  for (let index = 0; index < lows.length; index += 1) {
    const lowPivot = lows[index];
    const nextLowPivot = lows[index + 1];
    if (!lowPivot) continue;

    const candidateHighs = highs.filter(
      (pivot) =>
        pivot.index > lowPivot.index + 2 &&
        pivot.index < (nextLowPivot?.index ?? window.length),
    );

    if (candidateHighs.length === 0) continue;

    const highPivot = candidateHighs.reduce((best, pivot) =>
      pivot.price > best.price ? pivot : best,
    );

    const range = highPivot.price - lowPivot.price;
    if (range <= minimumLegRange) continue;

    const retracementPivot = nextLowPivot && nextLowPivot.price > lowPivot.price ? nextLowPivot : undefined;
    const retracementRatio = retracementPivot
      ? clamp((highPivot.price - retracementPivot.price) / range, 0, 1.5)
      : undefined;

    legs.push({
      lowPivot,
      highPivot,
      retracementPivot,
      range,
      retracementRatio,
    });
  }

  return legs;
}

function nearestPrimaryLevel(level: number) {
  return PRIMARY_LEVELS.reduce((best, candidate) =>
    Math.abs(candidate - level) < Math.abs(best - level) ? candidate : best,
  );
}

function determinePreferredLevel(legs: BullishLeg[]) {
  const counts = new Map<number, number>();

  for (const level of PRIMARY_LEVELS) {
    counts.set(level, 0);
  }

  for (const leg of legs) {
    if (leg.retracementRatio === undefined) continue;
    const nearest = nearestPrimaryLevel(leg.retracementRatio);
    counts.set(nearest, (counts.get(nearest) ?? 0) + 1);
  }

  const ranked = PRIMARY_LEVELS.map((level) => ({
    level,
    count: counts.get(level) ?? 0,
  })).sort((left, right) => right.count - left.count);

  const leader = ranked[0];
  const runnerUp = ranked[1];

  return {
    preferredLevel:
      leader && runnerUp && leader.count > runnerUp.count ? leader.level : 0.618,
    levelCounts: Object.fromEntries(ranked.map((item) => [String(item.level), item.count])),
    isMixed:
      !leader ||
      !runnerUp ||
      leader.count === 0 ||
      leader.count === runnerUp.count,
  };
}

function preferredBandForLevel(leg: BullishLeg, preferredLevel: number) {
  if (preferredLevel <= 0.5) {
    return {
      upperLevel: 0.5,
      lowerLevel: 0.618,
    };
  }

  if (preferredLevel >= 0.7) {
    return {
      upperLevel: 0.618,
      lowerLevel: 0.786,
    };
  }

  return {
    upperLevel: 0.5,
    lowerLevel: 0.7,
  };
}

function describePreferredLevel(level: number) {
  return level === 0.5 ? "0.500" : level === 0.7 ? "0.700" : "0.618";
}

export function deriveFibonacciArenaState({
  agentId,
  marketSymbol,
  timeframe,
  candles,
  newsState = "neutral",
}: FibonacciEngineInput): FibonacciEngineOutput | null {
  if (candles.length < 48) return null;

  const window = candles.slice(-resolveWindowSize(timeframe));
  const trend = detectTrend(window);
  const isBearish = trend === "bearish";
  const legs = isBearish ? buildBearishLegs(window) : buildBullishLegs(window);
  if (legs.length === 0) return null;

  const rangeBaseline =
    legs.reduce((total, leg) => total + leg.range, 0) / legs.length;
  const activeLeg =
    [...legs]
      .reverse()
      .find((leg) => leg.range >= rangeBaseline * 0.7) ?? legs[legs.length - 1];

  if (!activeLeg) return null;

  const historicalLegs = legs.filter(
    (leg) =>
      leg !== activeLeg &&
      leg.retracementPivot &&
      leg.retracementRatio !== undefined &&
      leg.retracementRatio >= 0.35 &&
      leg.retracementRatio <= 0.9,
  );

  const rhythm = determinePreferredLevel(
    historicalLegs.length > 0 ? historicalLegs.slice(-3) : [activeLeg],
  );
  const preferredLevel = rhythm.preferredLevel;

  // ── Zone & trade levels ───────────────────────────────────────────────────
  // fibPrice(leg, level) = highPivot.price - range * level
  //   level=0 → at the HIGH | level=1 → at the LOW
  //
  // Bullish (buy on pullback): price retraces DOWN from the high.
  //   Preferred zone = levels 0.5–0.7 (50–70% of the way down from high).
  //
  // Bearish (sell on bounce): price bounces UP from the low.
  //   A 50% bounce from the low = price at 50% of range above low = fibPrice(leg, 0.5).
  //   A 61.8% bounce from the low = fibPrice(leg, 0.382).
  //   Preferred short-entry zone = fibPrice(leg, 0.382) down to fibPrice(leg, 0.5).

  const broadZoneHigh = isBearish ? fibPrice(activeLeg, 0.382) : fibPrice(activeLeg, 0.5);
  const broadZoneLow  = isBearish ? fibPrice(activeLeg, 0.5)   : fibPrice(activeLeg, 0.7);

  const preferredBand = preferredBandForLevel(activeLeg, preferredLevel);
  // For bearish: mirror the level coordinates around the midpoint (1 - level).
  const preferredZoneHigh = isBearish
    ? fibPrice(activeLeg, 1 - preferredBand.lowerLevel)
    : fibPrice(activeLeg, preferredBand.upperLevel);
  const preferredZoneLow = isBearish
    ? fibPrice(activeLeg, 1 - preferredBand.upperLevel)
    : fibPrice(activeLeg, preferredBand.lowerLevel);
  const preferredEntry = isBearish
    ? fibPrice(activeLeg, 1 - preferredLevel)
    : fibPrice(activeLeg, preferredLevel);

  // Invalidation: bearish = price closes ABOVE the swing high; bullish = below swing low.
  const invalidationPivotPrice = isBearish
    ? (activeLeg.retracementPivot?.price ?? activeLeg.highPivot.price)
    : (activeLeg.retracementPivot?.price ?? activeLeg.lowPivot.price);
  const invalidationBuffer = activeLeg.range * 0.035;
  const invalidationPrice = isBearish
    ? invalidationPivotPrice + invalidationBuffer
    : invalidationPivotPrice - invalidationBuffer;

  const latest = window[window.length - 1];
  const previous = window[window.length - 2] ?? latest;
  if (!latest) return null;

  const recentCandles = window.slice(-3);
  const zoneTouchedRecently = recentCandles.some((candle) =>
    candleOverlapsZone(candle, broadZoneLow, broadZoneHigh),
  );
  const confirmation = isBearish
    ? detectBearishConfirmation(window, preferredZoneLow, preferredZoneHigh)
    : detectBullishConfirmation(window, preferredZoneLow, preferredZoneHigh);
  const confirmationCandle = window[confirmation.candleIndex] ?? latest;

  // ── Trade parameters ──────────────────────────────────────────────────────
  let entry: number;
  let stopLoss: number;
  let takeProfit: number;
  let rewardToRisk: number;

  if (isBearish) {
    entry = confirmation.confirmed ? confirmationCandle.close : preferredEntry;
    stopLoss = Math.max(
      confirmationCandle.high + activeLeg.range * 0.02,
      invalidationPrice,
    );
    takeProfit = Math.min(
      activeLeg.lowPivot.price - activeLeg.range * 0.272,
      entry - (stopLoss - entry) * 3,
    );
    rewardToRisk = entry < stopLoss ? (entry - takeProfit) / (stopLoss - entry) : 0;
  } else {
    entry = confirmation.confirmed ? confirmationCandle.close : preferredEntry;
    stopLoss = Math.min(
      confirmationCandle.low - activeLeg.range * 0.02,
      invalidationPrice,
    );
    takeProfit = Math.max(
      activeLeg.highPivot.price + activeLeg.range * 0.272,
      entry + (entry - stopLoss) * 3,
    );
    rewardToRisk = entry > stopLoss ? (takeProfit - entry) / (entry - stopLoss) : 0;
  }

  // ── Status ────────────────────────────────────────────────────────────────
  let status: TradeIdea["status"] = "watchlist";

  const invalidated = isBearish
    ? latest.close > invalidationPrice
    : latest.close < invalidationPrice;

  if (invalidated) {
    status = "watchlist";
  } else if (confirmation.confirmed && rewardToRisk >= 3) {
    status = "entered";
  } else if (
    zoneTouchedRecently ||
    (latest.close <= broadZoneHigh && latest.close >= broadZoneLow)
  ) {
    status = "ready";
  }

  if (newsState === "risk" && status === "entered") {
    status = "ready";
  }

  const triggerTimeSec =
    status === "entered"
      ? confirmationCandle.time
      : zoneTouchedRecently
        ? latest.time
        : isBearish ? activeLeg.lowPivot.time : activeLeg.highPivot.time;

  const confidenceBase =
    status === "entered" ? 0.82 : status === "ready" ? 0.72 : 0.64;
  const confidenceAdjustment =
    (rhythm.isMixed ? -0.05 : 0.03) +
    (newsState === "supportive" ? 0.04 : newsState === "risk" ? -0.08 : 0) +
    (rewardToRisk >= 3 ? 0.03 : -0.05);

  const direction = isBearish ? "short" : "long";

  const tradeIdea: TradeIdea = {
    id: `engine-idea-${agentId}-${marketSymbol}`,
    agentId,
    marketSymbol,
    direction,
    status,
    entry: roundForMarket(marketSymbol, entry),
    stopLoss: roundForMarket(marketSymbol, stopLoss),
    takeProfit: roundForMarket(marketSymbol, takeProfit),
    confidence: Number(clamp(confidenceBase + confidenceAdjustment, 0.42, 0.92).toFixed(2)),
    confluenceState: newsState,
    thesis: invalidated
      ? `The latest ${isBearish ? "bounce" : "pullback"} has broken through the invalidation level — the fib map stays on chart as context but is no longer actionable.`
      : newsState === "risk" && confirmation.confirmed
        ? `The ${describePreferredLevel(preferredLevel)} rhythm and trigger are present, but macro risk keeps the setup staged instead of entered.`
        : status === "entered"
          ? `${describePreferredLevel(preferredLevel)} has been the cleanest ${isBearish ? "bounce" : "retracement"} rhythm, and the latest candle confirmed ${isBearish ? "rejection" : "continuation"} from that band.`
          : status === "ready"
            ? `Price is reacting inside the ${describePreferredLevel(preferredLevel)} ${isBearish ? "rejection" : "continuation"} band. Waiting for a ${isBearish ? "bearish" : "bullish"} close trigger.`
            : `The broader ${isBearish ? "downtrend" : "uptrend"} is mapped, but price has not yet reached the preferred ${describePreferredLevel(preferredLevel)} reaction band.`,
  };

  const watchlistItem: WatchlistItem = {
    id: `engine-watch-${agentId}-${marketSymbol}`,
    agentId,
    marketSymbol,
    setupLabel: `Fib ${isBearish ? "short" : "continuation"} ${describePreferredLevel(preferredLevel)} rhythm`,
    timeframe,
    status: status === "watchlist" ? "watching" : "armed",
    triggerNote: invalidated
      ? `Structure is mapped, but the latest ${isBearish ? "bounce" : "pullback"} invalidated the setup.`
      : status === "entered"
        ? `${isBearish ? "Short" : "Continuation"} trigger has already fired from the preferred reaction band.`
        : `Track the ${describePreferredLevel(preferredLevel)} reaction band for a confirmed ${isBearish ? "bearish" : "bullish"} close.`,
    confluenceState: newsState,
  };

  // ── Annotations ───────────────────────────────────────────────────────────
  // For bearish legs, startTimeSec = highPivot.time (chronologically first, start of decline).
  // For bullish legs, startTimeSec = lowPivot.time (chronologically first, start of rise).
  // extractFibonacciLegs reads startTimeSec → lowTimeSec and endTimeSec → highTimeSec.
  // drawFibonacciWithChartApi uses direction to order the TradingView anchor points correctly.

  const fibAnchorStart = (leg: BullishLeg) => isBearish ? leg.highPivot : leg.lowPivot;
  const fibAnchorEnd   = (leg: BullishLeg) => isBearish ? leg.lowPivot  : leg.highPivot;

  const contextLegs = historicalLegs.slice(-3);
  const traceAnnotations: VisualAnnotation[] = contextLegs.map((leg, index) => ({
    id: `engine-context-fib-${marketSymbol}-${index}`,
    type: "fibonacci",
    label: `Prior leg ${index + 1}`,
    detail:
      leg.retracementRatio !== undefined
        ? `Earlier leg respected roughly the ${describePreferredLevel(
            nearestPrimaryLevel(leg.retracementRatio),
          )} ${isBearish ? "bounce" : "retracement"} rhythm.`
        : "Earlier leg used as structural context.",
    revealStep: 1,
    geometry: {
      kind: "fibonacci",
      startBarIndex: fibAnchorStart(leg).index,
      endBarIndex:   fibAnchorEnd(leg).index,
      startTimeSec:  fibAnchorStart(leg).time,
      endTimeSec:    fibAnchorEnd(leg).time,
      highPrice: leg.highPivot.price,
      lowPrice:  leg.lowPivot.price,
      levels: RENDER_LEVELS,
      tone: "muted",
    },
  }));

  // Zone anchor bar: for bullish = from the high pivot onward; for bearish = from the low onward.
  const zoneAnchorPivot = isBearish ? activeLeg.lowPivot : activeLeg.highPivot;

  traceAnnotations.push(
    {
      id: `engine-active-fib-${marketSymbol}`,
      type: "fibonacci",
      label: "Active continuation leg",
      detail: `Current fib draw is anchored from the ${isBearish ? "swing high down to the swing low" : "swing low up to the swing high"}. Preferred rhythm: ${describePreferredLevel(preferredLevel)}.`,
      revealStep: 2,
      geometry: {
        kind: "fibonacci",
        startBarIndex: fibAnchorStart(activeLeg).index,
        endBarIndex:   fibAnchorEnd(activeLeg).index,
        startTimeSec:  fibAnchorStart(activeLeg).time,
        endTimeSec:    fibAnchorEnd(activeLeg).time,
        highPrice: activeLeg.highPivot.price,
        lowPrice:  activeLeg.lowPivot.price,
        levels: RENDER_LEVELS,
      },
    },
    {
      id: `engine-broad-zone-${marketSymbol}`,
      type: "zone",
      label: "Broad reaction band",
      detail: isBearish
        ? "The wider short-entry band spans the 50–61.8% bounce zone from the swing low."
        : "The wider continuation band spans the 0.500 to 0.700 retracement zone for this impulse.",
      revealStep: 3,
      geometry: {
        kind: "zone",
        startBarIndex: zoneAnchorPivot.index,
        endBarIndex: window.length - 1,
        startTimeSec: zoneAnchorPivot.time,
        endTimeSec: latest.time,
        highPrice: broadZoneHigh,
        lowPrice: broadZoneLow,
        tone: "muted",
      },
    },
    {
      id: `engine-preferred-zone-${marketSymbol}`,
      type: "zone",
      label: `${describePreferredLevel(preferredLevel)} reaction band`,
      detail: rhythm.isMixed
        ? "Recent legs were mixed, so the reaction band stays broad while centered around 0.618."
        : `Recent legs have most consistently responded near ${describePreferredLevel(preferredLevel)}.`,
      revealStep: 4,
      geometry: {
        kind: "zone",
        startBarIndex: zoneAnchorPivot.index,
        endBarIndex: window.length - 1,
        startTimeSec: zoneAnchorPivot.time,
        endTimeSec: latest.time,
        highPrice: preferredZoneHigh,
        lowPrice: preferredZoneLow,
        tone: "zone",
      },
    },
    {
      id: `engine-invalidation-zone-${marketSymbol}`,
      type: "zone",
      label: "Invalidation shelf",
      detail: isBearish
        ? "A close above this upper shelf would break the active bearish continuation idea."
        : "A close beneath this lower shelf would break the active bullish continuation idea.",
      revealStep: 5,
      geometry: {
        kind: "zone",
        startBarIndex: zoneAnchorPivot.index,
        endBarIndex: window.length - 1,
        startTimeSec: zoneAnchorPivot.time,
        endTimeSec: latest.time,
        highPrice: isBearish ? invalidationPrice : invalidationPivotPrice,
        lowPrice:  isBearish ? invalidationPivotPrice : invalidationPrice,
        tone: "stop",
      },
    },
    {
      id: `engine-rhythm-note-${marketSymbol}`,
      type: "note",
      label: "Preferred retracement",
      detail: `The latest ${Math.max(contextLegs.length, 1)} legs most closely match the ${describePreferredLevel(preferredLevel)} ${isBearish ? "bounce" : "pullback"} rhythm.`,
      revealStep: 5,
      geometry: {
        kind: "marker",
        position: { barIndex: window.length - 1, timeSec: latest.time, price: preferredEntry },
        text: `${describePreferredLevel(preferredLevel)} bias`,
        tone: "zone",
      },
    },
  );

  if (status === "ready" || status === "entered") {
    traceAnnotations.push(
      {
        id: `engine-entry-${marketSymbol}`,
        type: "entry",
        label: status === "entered" ? (isBearish ? "Short trigger" : "Long trigger") : "Planned entry",
        detail:
          status === "entered"
            ? confirmation.label
            : `The preferred entry sits at the dominant ${isBearish ? "bounce" : "retracement"} rhythm until a ${isBearish ? "bearish" : "bullish"} close confirms continuation.`,
        revealStep: 6,
        geometry: {
          kind: "marker",
          position: {
            barIndex: status === "entered" ? confirmation.candleIndex : window.length - 1,
            timeSec: status === "entered" ? confirmationCandle.time : latest.time,
            price: entry,
          },
          text: "Entry",
          tone: "entry",
        },
      },
      {
        id: `engine-stop-${marketSymbol}`,
        type: "stop-loss",
        label: "Risk line",
        detail: isBearish
            ? "The stop sits above the swing high and invalidation shelf."
            : "The stop stays beneath the most recent structural retracement low and invalidation shelf.",
        revealStep: 6,
        geometry: {
          kind: "marker",
          position: {
            barIndex: window.length - 1,
            timeSec: latest.time,
            price: stopLoss,
          },
          text: "SL",
          tone: "stop",
        },
      },
      {
        id: `engine-target-${marketSymbol}`,
        type: "take-profit",
        label: "Continuation target",
        detail: isBearish
            ? "The primary target extends below the prior swing low while keeping a minimum 1:3 structure."
            : "The primary target extends beyond the prior swing high while keeping a minimum 1:3 structure.",
        revealStep: 6,
        geometry: {
          kind: "marker",
          position: {
            barIndex: window.length - 1,
            timeSec: latest.time,
            price: takeProfit,
          },
          text: "TP",
          tone: "target",
        },
      },
    );
  }

  const trace: VisualTrace = {
    id: `engine-trace-${agentId}-${marketSymbol}`,
    agentId,
    marketSymbol,
    timeframe,
    updatedAt: "Engine derived",
    annotations: traceAnnotations,
  };

  const events: TradeEvent[] = [
    {
      id: `engine-event-rhythm-${marketSymbol}`,
      agentId,
      marketSymbol,
      timestamp: formatEventLabel(activeLeg.highPivot.time),
      eventTimeSec: activeLeg.highPivot.time,
      title: `${isBearish ? "Bearish" : "Bullish"} rhythm favors ${describePreferredLevel(preferredLevel)}`,
      detail: rhythm.isMixed
        ? "Recent pullbacks were mixed, but 0.618 remains the best neutral default for the current trend."
        : `The last continuation legs most consistently respected the ${describePreferredLevel(preferredLevel)} retracement level.`,
      stage: "watchlist",
      focusKind: "area",
    },
    {
      id: `engine-event-zone-${marketSymbol}`,
      agentId,
      marketSymbol,
      timestamp: formatEventLabel(latest.time),
      eventTimeSec: latest.time,
      title: zoneTouchedRecently ? "Reaction band engaged" : "Reaction band projected",
      detail: zoneTouchedRecently
        ? `Price has traded into the preferred ${describePreferredLevel(preferredLevel)} band and is now waiting for confirmation.`
        : `The active impulse projects a continuation band between ${roundForMarket(
            marketSymbol,
            preferredZoneLow,
          )} and ${roundForMarket(marketSymbol, preferredZoneHigh)}.`,
      stage: status === "watchlist" ? "watchlist" : "ready",
      focusKind: "area",
    },
    {
      id: `engine-event-trigger-${marketSymbol}`,
      agentId,
      marketSymbol,
      timestamp: formatEventLabel(triggerTimeSec),
      eventTimeSec: triggerTimeSec,
      title:
        invalidated
          ? "Structure invalidated"
          : newsState === "risk" && confirmation.confirmed
            ? "Risk filter active"
            : status === "entered"
              ? "Entry confirmed"
              : "Confirmation pending",
      detail:
        invalidated
          ? "The latest close has broken through the invalidation shelf — the fib map remains visible only as failed context."
          : newsState === "risk" && confirmation.confirmed
            ? "The candle trigger landed, but current macro risk keeps the setup staged instead of promoted into an entered trade."
            : status === "entered"
              ? confirmation.label
              : `The continuation map is valid, but the market still needs a ${isBearish ? "bearish" : "bullish"} close trigger from the reaction band.`,
      stage:
        invalidated
          ? "watchlist"
          : status === "entered"
            ? "entered"
            : "ready",
      focusKind: status === "entered" ? "point" : "area",
    },
  ];

  const position =
    status === "entered"
      ? {
          id: `engine-position-${agentId}-${marketSymbol}`,
          agentId,
          marketSymbol,
          direction: "long" as const,
          timeframe,
          entry: roundForMarket(marketSymbol, entry),
          markPrice: roundForMarket(marketSymbol, latest.close),
          stopLoss: roundForMarket(marketSymbol, stopLoss),
          takeProfit: roundForMarket(marketSymbol, takeProfit),
          pnlPercent: Number((((latest.close - entry) / entry) * 100).toFixed(2)),
          progressLabel: `Tracking ${describePreferredLevel(preferredLevel)} fib continuation`,
          nextCheckIn:
            timeframe === "15m" ? "in 30m" : timeframe === "1h" ? "in 2h" : "in 8h",
        }
      : undefined;

  return {
    tradeIdea,
    trace,
    events,
    watchlistItem,
    position,
  };
}
