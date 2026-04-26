import type {
  ConfluenceState,
  Position,
  TradeDirection,
  TradeEvent,
  TradeIdea,
  TradeTimeframe,
  VisualTrace,
  WatchlistItem,
} from "./arena-types";
import type { PythCandle } from "./pyth-history";

type ThirdTouchEngineInput = {
  agentId: string;
  marketSymbol: string;
  timeframe: TradeTimeframe;
  candles: PythCandle[];
  newsState?: ConfluenceState;
};

type ThirdTouchEngineOutput = {
  tradeIdea: TradeIdea;
  trace: VisualTrace;
  events: TradeEvent[];
  watchlistItem: WatchlistItem;
  position?: Position;
};

type SwingPoint = {
  barIndex: number;
  price: number;
};

type TrendRegime = "bullish" | "bearish" | "mixed";

type TrendlinePair = {
  touch1: SwingPoint;
  touch2: SwingPoint;
  score: number;
};

type ThirdTouchEvaluation = {
  touch1: SwingPoint;
  touch2: SwingPoint;
  candidateBarIndex: number;
  candidate: PythCandle;
  candidatePrevious: PythCandle;
  projectedLinePrice: number;
  touchTolerance: number;
  bodyTolerance: number;
  candidateIsNearLine: boolean;
  proximityTouch: boolean;
  wickPenetration: boolean;
  perfectTouch: boolean;
  closesAggressivelyThroughLine: boolean;
  score: number;
};

const THIRD_TOUCH_ACTIVE_WINDOW_CANDLES = 168;
const THIRD_TOUCH_SWING_RADIUS = 10;

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

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function findSwingLows(
  candles: PythCandle[],
  radius = THIRD_TOUCH_SWING_RADIUS,
): SwingPoint[] {
  const swings: SwingPoint[] = [];

  for (let index = radius; index < candles.length - radius; index += 1) {
    const candle = candles[index];
    let isSwingLow = true;

    for (let offset = 1; offset <= radius; offset += 1) {
      if (
        candle.low >= candles[index - offset].low ||
        candle.low >= candles[index + offset].low
      ) {
        isSwingLow = false;
        break;
      }
    }

    if (isSwingLow) {
      swings.push({
        barIndex: index,
        price: candle.low,
      });
    }
  }

  return swings;
}

function findSwingHighs(
  candles: PythCandle[],
  radius = THIRD_TOUCH_SWING_RADIUS,
): SwingPoint[] {
  const swings: SwingPoint[] = [];

  for (let index = radius; index < candles.length - radius; index += 1) {
    const candle = candles[index];
    let isSwingHigh = true;

    for (let offset = 1; offset <= radius; offset += 1) {
      if (
        candle.high <= candles[index - offset].high ||
        candle.high <= candles[index + offset].high
      ) {
        isSwingHigh = false;
        break;
      }
    }

    if (isSwingHigh) {
      swings.push({
        barIndex: index,
        price: candle.high,
      });
    }
  }

  return swings;
}

function getProjectedLinePrice(
  touch1: SwingPoint,
  touch2: SwingPoint,
  targetBarIndex: number,
) {
  const barDistance = touch2.barIndex - touch1.barIndex;
  if (barDistance <= 0) return touch2.price;

  const slope = (touch2.price - touch1.price) / barDistance;
  return touch1.price + slope * (targetBarIndex - touch1.barIndex);
}

function findDominantBullishPair(
  candles: PythCandle[],
  swingLows: SwingPoint[],
  touchTolerance: number,
): TrendlinePair | null {
  const latestIndex = candles.length - 1;
  const averageRange = average(
    candles.slice(-20).map((candle) => candle.high - candle.low),
  );
  let best: TrendlinePair | null = null;

  for (let leftIndex = 0; leftIndex < swingLows.length - 1; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < swingLows.length;
      rightIndex += 1
    ) {
      const touch1 = swingLows[leftIndex];
      const touch2 = swingLows[rightIndex];
      const span = touch2.barIndex - touch1.barIndex;

      if (touch2.price <= touch1.price || span < 4) continue;

      const projectedLatestPrice = getProjectedLinePrice(
        touch1,
        touch2,
        latestIndex,
      );
      const latestDistance = Math.abs(projectedLatestPrice - candles[latestIndex].low);
      if (projectedLatestPrice < candles[latestIndex].low - averageRange * 3.5) {
        continue;
      }

      let reactionTouches = 0;
      let closeViolations = 0;

      for (let index = touch2.barIndex + 1; index <= latestIndex; index += 1) {
        const candle = candles[index];
        const projectedPrice = getProjectedLinePrice(touch1, touch2, index);
        const nearTouch = candle.low <= projectedPrice + touchTolerance;
        const rejectedFromLine = candle.close >= projectedPrice - touchTolerance;
        const hardViolation = candle.close < projectedPrice - touchTolerance * 1.6;

        if (nearTouch && rejectedFromLine) {
          reactionTouches += 1;
        }

        if (hardViolation) {
          closeViolations += 1;
        }
      }

      const score =
        span * 0.18 +
        (touch2.price - touch1.price) / Math.max(averageRange, Number.EPSILON) +
        reactionTouches * 3.2 -
        closeViolations * 4.6 -
        latestDistance / Math.max(averageRange, Number.EPSILON);

      if (!best || score > best.score) {
        best = { touch1, touch2, score };
      }
    }
  }

  return best;
}

function findDominantBearishPair(
  candles: PythCandle[],
  swingHighs: SwingPoint[],
  touchTolerance: number,
): TrendlinePair | null {
  const latestIndex = candles.length - 1;
  const averageRange = average(
    candles.slice(-20).map((candle) => candle.high - candle.low),
  );
  let best: TrendlinePair | null = null;

  for (let leftIndex = 0; leftIndex < swingHighs.length - 1; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < swingHighs.length;
      rightIndex += 1
    ) {
      const touch1 = swingHighs[leftIndex];
      const touch2 = swingHighs[rightIndex];
      const span = touch2.barIndex - touch1.barIndex;

      if (touch2.price >= touch1.price || span < 4) continue;

      const projectedLatestPrice = getProjectedLinePrice(
        touch1,
        touch2,
        latestIndex,
      );
      const latestDistance = Math.abs(projectedLatestPrice - candles[latestIndex].high);
      if (projectedLatestPrice > candles[latestIndex].high + averageRange * 3.5) {
        continue;
      }

      let reactionTouches = 0;
      let closeViolations = 0;

      for (let index = touch2.barIndex + 1; index <= latestIndex; index += 1) {
        const candle = candles[index];
        const projectedPrice = getProjectedLinePrice(touch1, touch2, index);
        const nearTouch = candle.high >= projectedPrice - touchTolerance;
        const rejectedFromLine = candle.close <= projectedPrice + touchTolerance;
        const hardViolation = candle.close > projectedPrice + touchTolerance * 1.6;

        if (nearTouch && rejectedFromLine) {
          reactionTouches += 1;
        }

        if (hardViolation) {
          closeViolations += 1;
        }
      }

      const score =
        span * 0.18 +
        (touch1.price - touch2.price) / Math.max(averageRange, Number.EPSILON) +
        reactionTouches * 3.2 -
        closeViolations * 4.6 -
        latestDistance / Math.max(averageRange, Number.EPSILON);

      if (!best || score > best.score) {
        best = { touch1, touch2, score };
      }
    }
  }

  return best;
}

function findBestThirdTouchCandidate(
  candles: PythCandle[],
  touch1: SwingPoint,
  touch2: SwingPoint,
  touchTolerance: number,
  direction: TradeDirection,
) {
  const searchStart = Math.min(candles.length - 1, touch2.barIndex + 3);
  let bestBarIndex = candles.length - 1;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestProjectedLinePrice = getProjectedLinePrice(
    touch1,
    touch2,
    bestBarIndex,
  );

  for (let index = searchStart; index < candles.length; index += 1) {
    const candle = candles[index];
    const projectedLinePrice = getProjectedLinePrice(touch1, touch2, index);
    const touchPrice = direction === "long" ? candle.low : candle.high;
    const touchDistance = Math.abs(touchPrice - projectedLinePrice);
    const closeDistance = Math.abs(candle.close - projectedLinePrice);
    const offsidePenalty =
      direction === "long"
        ? touchPrice > projectedLinePrice + touchTolerance * 2
          ? touchPrice - (projectedLinePrice + touchTolerance * 2)
          : 0
        : touchPrice < projectedLinePrice - touchTolerance * 2
          ? projectedLinePrice - touchTolerance * 2 - touchPrice
          : 0;
    const score = touchDistance + closeDistance * 0.35 + offsidePenalty * 1.5;

    if (score < bestScore) {
      bestScore = score;
      bestBarIndex = index;
      bestProjectedLinePrice = projectedLinePrice;
    }
  }

  return {
    barIndex: bestBarIndex,
    projectedLinePrice: bestProjectedLinePrice,
    score: bestScore,
  };
}

function buildReplacementTouch2(
  candle: PythCandle,
  barIndex: number,
  direction: TradeDirection,
): SwingPoint {
  return {
    barIndex,
    price:
      direction === "long"
        ? Math.min(candle.open, candle.close)
        : Math.max(candle.open, candle.close),
  };
}

function findBodyInvalidationReplacementTouch2(args: {
  candles: PythCandle[];
  touch1: SwingPoint;
  touch2: SwingPoint;
  direction: TradeDirection;
  averageRange: number;
}) {
  const { candles, touch1, touch2, direction, averageRange } = args;
  for (
    let index = touch2.barIndex + 1;
    index < candles.length - 2;
    index += 1
  ) {
    const candle = candles[index];
    const projectedLinePrice = getProjectedLinePrice(touch1, touch2, index);
    const bodyLow = Math.min(candle.open, candle.close);
    const bodyHigh = Math.max(candle.open, candle.close);
    const bodyTolerance = Math.max(
      averageRange * 0.18,
      Math.abs(projectedLinePrice) * 0.0006,
    );

    const lineRunsThroughBody =
      projectedLinePrice >= bodyLow - bodyTolerance * 0.2 &&
      projectedLinePrice <= bodyHigh + bodyTolerance * 0.2;
    const closesThroughLine =
      direction === "long"
        ? candle.close < projectedLinePrice - bodyTolerance
        : candle.close > projectedLinePrice + bodyTolerance;

    if (!lineRunsThroughBody && !closesThroughLine) {
      continue;
    }

    return buildReplacementTouch2(candle, index, direction);
  }

  return null;
}

function evaluateThirdTouchCandidate(args: {
  candles: PythCandle[];
  touch1: SwingPoint;
  touch2: SwingPoint;
  direction: TradeDirection;
  averageRange: number;
}) {
  const { candles, touch1, touch2, direction, averageRange } = args;
  const provisionalProjectedLinePrice = getProjectedLinePrice(
    touch1,
    touch2,
    candles.length - 1,
  );
  const touchTolerance = Math.max(
    averageRange * 0.35,
    provisionalProjectedLinePrice * 0.0012,
  );
  const bestCandidate = findBestThirdTouchCandidate(
    candles,
    touch1,
    touch2,
    touchTolerance,
    direction,
  );
  const candidateBarIndex = bestCandidate.barIndex;
  const candidate = candles[candidateBarIndex];
  const candidatePrevious = candles[candidateBarIndex - 1] ?? candidate;
  const projectedLinePrice = bestCandidate.projectedLinePrice;
  const bodyTolerance = Math.max(
    averageRange * 0.18,
    projectedLinePrice * 0.0006,
  );
  const candidateIsNearLine =
    bestCandidate.score <= touchTolerance * 2.4 ||
    (direction === "long"
      ? candidate.low <= projectedLinePrice + touchTolerance * 1.25
      : candidate.high >= projectedLinePrice - touchTolerance * 1.25);
  const proximityTouch =
    candidateIsNearLine &&
    Math.abs(
      (direction === "long" ? candidate.low : candidate.high) -
        projectedLinePrice,
    ) <= touchTolerance;
  const wickPenetration =
    candidateIsNearLine &&
    (direction === "long"
      ? candidate.low < projectedLinePrice - bodyTolerance &&
        candidate.close >= projectedLinePrice - bodyTolerance
      : candidate.high > projectedLinePrice + bodyTolerance &&
        candidate.close <= projectedLinePrice + bodyTolerance);
  const perfectTouch =
    candidateIsNearLine &&
    (direction === "long"
      ? candidate.low <= projectedLinePrice + bodyTolerance &&
        candidate.low >= projectedLinePrice - bodyTolerance &&
        candidate.close > projectedLinePrice
      : candidate.high >= projectedLinePrice - bodyTolerance &&
        candidate.high <= projectedLinePrice + bodyTolerance &&
        candidate.close < projectedLinePrice);
  const closesAggressivelyThroughLine =
    direction === "long"
      ? candidate.close < projectedLinePrice - touchTolerance &&
        candidate.close < candidate.open &&
        Math.abs(candidate.close - candidate.open) >= averageRange * 0.55
      : candidate.close > projectedLinePrice + touchTolerance &&
        candidate.close > candidate.open &&
        Math.abs(candidate.close - candidate.open) >= averageRange * 0.55;

  return {
    touch1,
    touch2,
    candidateBarIndex,
    candidate,
    candidatePrevious,
    projectedLinePrice,
    touchTolerance,
    bodyTolerance,
    candidateIsNearLine,
    proximityTouch,
    wickPenetration,
    perfectTouch,
    closesAggressivelyThroughLine,
    score: bestCandidate.score,
  } satisfies ThirdTouchEvaluation;
}

function detectTrendRegime(
  candles: PythCandle[],
  swingLows: SwingPoint[],
  swingHighs: SwingPoint[],
): TrendRegime {
  const averageRange = average(
    candles.slice(-20).map((candle) => candle.high - candle.low),
  );
  const recent = candles.slice(-24);
  const firstClose = recent[0]?.close ?? candles[0]?.close ?? 0;
  const lastClose =
    recent[recent.length - 1]?.close ?? candles[candles.length - 1]?.close ?? 0;
  const closeDrift = lastClose - firstClose;
  const fullWindowDrift =
    (candles[candles.length - 1]?.close ?? 0) - (candles[0]?.close ?? 0);

  const recentSwingLows = swingLows.slice(-5);
  const recentSwingHighs = swingHighs.slice(-5);

  const lowTrendScore = recentSwingLows.reduce((score, swing, index) => {
    if (index === 0) return score;
    return score + Math.sign(swing.price - recentSwingLows[index - 1].price);
  }, 0);
  const highTrendScore = recentSwingHighs.reduce((score, swing, index) => {
    if (index === 0) return score;
    return score + Math.sign(swing.price - recentSwingHighs[index - 1].price);
  }, 0);

  const bullishVotes =
    (lowTrendScore >= 2 ? 2 : 0) +
    (highTrendScore >= 1 ? 2 : 0) +
    (closeDrift > averageRange * 0.8 ? 1 : 0) +
    (fullWindowDrift > averageRange * 2 ? 1 : 0);
  const bearishVotes =
    (highTrendScore <= -2 ? 2 : 0) +
    (lowTrendScore <= -1 ? 2 : 0) +
    (closeDrift < -averageRange * 0.8 ? 1 : 0) +
    (fullWindowDrift < -averageRange * 2 ? 1 : 0);

  if (bullishVotes >= 3 && bullishVotes > bearishVotes) {
    return "bullish";
  }

  if (bearishVotes >= 3 && bearishVotes > bullishVotes) {
    return "bearish";
  }

  return "mixed";
}

function classifyCandlestickConfirmation(
  previous: PythCandle,
  current: PythCandle,
  projectedLinePrice: number,
  tolerance: number,
) {
  const range = Math.max(current.high - current.low, Number.EPSILON);
  const body = Math.abs(current.close - current.open);
  const lowerWick = Math.min(current.open, current.close) - current.low;
  const upperWick = current.high - Math.max(current.open, current.close);
  const previousBodyLow = Math.min(previous.open, previous.close);
  const previousBodyHigh = Math.max(previous.open, previous.close);
  const currentBodyLow = Math.min(current.open, current.close);
  const currentBodyHigh = Math.max(current.open, current.close);

  const hammer =
    lowerWick >= body * 2 &&
    upperWick <= Math.max(body, tolerance) &&
    current.close >= projectedLinePrice - tolerance;

  const bullishEngulfing =
    previous.close < previous.open &&
    current.close > current.open &&
    currentBodyLow <= previousBodyLow &&
    currentBodyHigh >= previousBodyHigh;

  const doji =
    body <= range * 0.15 &&
    current.low <= projectedLinePrice + tolerance &&
    current.close >= projectedLinePrice - tolerance;

  const tweezerBottom =
    Math.abs(current.low - previous.low) <= tolerance &&
    current.close > current.open;

  const matches = [hammer, bullishEngulfing, doji, tweezerBottom].filter(Boolean)
    .length;

  return {
    hammer,
    bullishEngulfing,
    doji,
    tweezerBottom,
    matches,
  };
}

function classifyBearishCandlestickConfirmation(
  previous: PythCandle,
  current: PythCandle,
  projectedLinePrice: number,
  tolerance: number,
) {
  const range = Math.max(current.high - current.low, Number.EPSILON);
  const body = Math.abs(current.close - current.open);
  const upperWick = current.high - Math.max(current.open, current.close);
  const lowerWick = Math.min(current.open, current.close) - current.low;
  const previousBodyLow = Math.min(previous.open, previous.close);
  const previousBodyHigh = Math.max(previous.open, previous.close);
  const currentBodyLow = Math.min(current.open, current.close);
  const currentBodyHigh = Math.max(current.open, current.close);

  const shootingStar =
    upperWick >= body * 2 &&
    lowerWick <= Math.max(body, tolerance) &&
    current.close <= projectedLinePrice + tolerance;

  const bearishEngulfing =
    previous.close > previous.open &&
    current.close < current.open &&
    currentBodyHigh >= previousBodyHigh &&
    currentBodyLow <= previousBodyLow;

  const doji =
    body <= range * 0.15 &&
    current.high >= projectedLinePrice - tolerance &&
    current.close <= projectedLinePrice + tolerance;

  const tweezerTop =
    Math.abs(current.high - previous.high) <= tolerance &&
    current.close < current.open;

  const matches = [shootingStar, bearishEngulfing, doji, tweezerTop].filter(Boolean)
    .length;

  return {
    shootingStar,
    bearishEngulfing,
    doji,
    tweezerTop,
    matches,
  };
}

export function deriveThirdTouchArenaState({
  agentId,
  marketSymbol,
  timeframe,
  candles,
  newsState = "neutral",
}: ThirdTouchEngineInput): ThirdTouchEngineOutput | null {
  if (candles.length < 45) return null;

  const window = candles.slice(-THIRD_TOUCH_ACTIVE_WINDOW_CANDLES);
  const swingLows = findSwingLows(window);
  const swingHighs = findSwingHighs(window);
  const regime = detectTrendRegime(window, swingLows, swingHighs);
  const averageRange = average(
    window.slice(-20).map((candle) => candle.high - candle.low),
  );
  const recent = window.slice(-24);
  const firstRecentClose = recent[0]?.close ?? window[0]?.close ?? 0;
  const lastRecentClose = recent[recent.length - 1]?.close ?? window[window.length - 1]?.close ?? 0;
  const closeDrift = lastRecentClose - firstRecentClose;
  const fullWindowDrift =
    (window[window.length - 1]?.close ?? 0) - (window[0]?.close ?? 0);
  const provisionalTolerance = Math.max(
    averageRange * 0.35,
    (window[window.length - 1]?.close ?? 0) * 0.0012,
  );
  const bullishPair =
    swingLows.length >= 2
      ? findDominantBullishPair(window, swingLows, provisionalTolerance)
      : null;
  const bearishPair =
    swingHighs.length >= 2
      ? findDominantBearishPair(window, swingHighs, provisionalTolerance)
      : null;

  let direction: TradeDirection;
  let touch1: SwingPoint | null = null;
  let touch2: SwingPoint | null = null;
  const bullishScore =
    (bullishPair?.score ?? Number.NEGATIVE_INFINITY) +
    (regime === "bullish" ? 7 : regime === "mixed" ? 0 : -7) +
    (closeDrift > averageRange * 0.5 ? 2.5 : closeDrift > 0 ? 1 : -2) +
    (fullWindowDrift > averageRange * 1.5 ? 2 : fullWindowDrift > 0 ? 0.75 : -2);
  const bearishScore =
    (bearishPair?.score ?? Number.NEGATIVE_INFINITY) +
    (regime === "bearish" ? 7 : regime === "mixed" ? 0 : -7) +
    (closeDrift < -averageRange * 0.5 ? 2.5 : closeDrift < 0 ? 1 : -2) +
    (fullWindowDrift < -averageRange * 1.5 ? 2 : fullWindowDrift < 0 ? 0.75 : -2);

  if (!bullishPair && !bearishPair) {
    return null;
  }

  if (bearishScore > bullishScore) {
    direction = "short";
    touch1 = bearishPair?.touch1 ?? null;
    touch2 = bearishPair?.touch2 ?? null;
  } else {
    direction = "long";
    touch1 = bullishPair?.touch1 ?? null;
    touch2 = bullishPair?.touch2 ?? null;
  }

  if (!touch1 || !touch2) return null;

  for (let iteration = 0; iteration < 5; iteration += 1) {
    const replacementTouch2 = findBodyInvalidationReplacementTouch2({
      candles: window,
      touch1,
      touch2,
      direction,
      averageRange,
    });

    if (!replacementTouch2 || replacementTouch2.barIndex <= touch2.barIndex) {
      break;
    }

    const directionStillValid =
      (direction === "long" && replacementTouch2.price > touch1.price) ||
      (direction === "short" && replacementTouch2.price < touch1.price);

    if (!directionStillValid) {
      break;
    }

    touch2 = replacementTouch2;
  }

  const evaluation = evaluateThirdTouchCandidate({
    candles: window,
    touch1,
    touch2,
    direction,
    averageRange,
  });

  touch1 = evaluation.touch1;
  touch2 = evaluation.touch2;

  const candidateBarIndex = evaluation.candidateBarIndex;
  const candidate = evaluation.candidate;
  const candidatePrevious = evaluation.candidatePrevious;
  const latest = window[window.length - 1];
  const projectedLinePrice = evaluation.projectedLinePrice;
  const touchTolerance = evaluation.touchTolerance;
  const bodyTolerance = evaluation.bodyTolerance;
  const candidateIsNearLine = evaluation.candidateIsNearLine;
  const proximityTouch = evaluation.proximityTouch;
  const wickPenetration = evaluation.wickPenetration;
  const perfectTouch = evaluation.perfectTouch;
  const closesAggressivelyThroughLine =
    evaluation.closesAggressivelyThroughLine;

  const confirmation =
    direction === "long"
      ? classifyCandlestickConfirmation(
          candidatePrevious,
          candidate,
          projectedLinePrice,
          touchTolerance,
        )
      : classifyBearishCandlestickConfirmation(
          candidatePrevious,
          candidate,
          projectedLinePrice,
          touchTolerance,
        );

  const recentResistance =
    direction === "long"
      ? swingHighs
          .filter((swing) => swing.barIndex > touch2.barIndex)
          .map((swing) => swing.price)
          .reduce((highest, price) => Math.max(highest, price), candidate.high) ??
        candidate.high
      : swingLows
          .filter((swing) => swing.barIndex > touch2.barIndex)
          .map((swing) => swing.price)
          .reduce((lowest, price) => Math.min(lowest, price), candidate.low) ??
        candidate.low;

  const proposedEntry = closesAggressivelyThroughLine
    ? projectedLinePrice
    : confirmation.matches > 0
      ? candidate.close
      : projectedLinePrice;
  const stopAnchor = touch2.price;
  const proposedStopLoss =
    direction === "long"
      ? stopAnchor - touchTolerance * 1.4
      : stopAnchor + touchTolerance * 1.4;
  const riskDistance = Math.abs(proposedEntry - proposedStopLoss);
  const proposedTakeProfit =
    direction === "long"
      ? proposedEntry + riskDistance * 3
      : proposedEntry - riskDistance * 3;
  const rrBlockedByResistance =
    direction === "long"
      ? proposedTakeProfit > recentResistance * 1.01
      : proposedTakeProfit < recentResistance * 0.99;

  let status: TradeIdea["status"] = "watchlist";
  if (
    candidateIsNearLine &&
    (perfectTouch || wickPenetration || proximityTouch) &&
    !closesAggressivelyThroughLine
  ) {
    status = confirmation.matches > 0 && !rrBlockedByResistance ? "entered" : "ready";
  }

  if (newsState === "risk" && status === "entered") {
    status = "ready";
  }

  const watchlistStatus: WatchlistItem["status"] =
    status === "watchlist" ? "watching" : "armed";

  const confidence = closesAggressivelyThroughLine
    ? 0.31
    : status === "entered"
      ? 0.76 + Math.min(confirmation.matches, 2) * 0.04
      : status === "ready"
        ? 0.66
        : 0.54;

  const triggerSummary = closesAggressivelyThroughLine
    ? direction === "long"
      ? "A bearish body closed beneath the projected line and invalidated the touch."
      : "A bullish body closed above the projected line and invalidated the touch."
    : confirmation.matches > 1
      ? direction === "long"
        ? "Multiple bullish confirmation patterns printed at the projected third touch."
        : "Multiple bearish confirmation patterns printed at the projected third touch."
      : confirmation.matches === 1
        ? direction === "long"
          ? "A valid bullish trigger printed on the projected third-touch reaction."
          : "A valid bearish trigger printed on the projected third-touch reaction."
        : direction === "long"
          ? "Price is now sitting on the projected third-touch zone and waiting for a confirmation candle."
          : "Price is now sitting on the projected third-touch rejection zone and waiting for confirmation.";

  const tradeIdea: TradeIdea = {
    id: `engine-third-touch-idea-${agentId}-${marketSymbol}`,
    agentId,
    marketSymbol,
    direction,
    status,
    entry: roundForMarket(marketSymbol, proposedEntry),
    stopLoss: roundForMarket(marketSymbol, proposedStopLoss),
    takeProfit: roundForMarket(marketSymbol, proposedTakeProfit),
    confidence: Number(
      Math.min(
        confidence + (newsState === "supportive" ? 0.04 : newsState === "risk" ? -0.08 : 0),
        0.92,
      ).toFixed(2),
    ),
    confluenceState: newsState,
    thesis:
      newsState === "risk"
        ? "The projected third-touch setup is valid, but current headline risk keeps it staged instead of entered."
        : closesAggressivelyThroughLine
          ? direction === "long"
            ? "The projected third-touch line failed because price closed aggressively below support."
            : "The projected third-touch line failed because price closed aggressively above resistance."
          : rrBlockedByResistance
            ? direction === "long"
              ? "The third-touch structure is valid, but nearby overhead resistance does not leave a clean 1:3 reward path yet."
              : "The third-touch structure is valid, but nearby downside support does not leave a clean 1:3 reward path yet."
            : triggerSummary,
  };

  const watchlistItem: WatchlistItem = {
    id: `engine-third-touch-watch-${agentId}-${marketSymbol}`,
    agentId,
    marketSymbol,
    setupLabel:
      direction === "long"
        ? "Projected third touch on ascending trendline"
        : "Projected third touch on descending trendline",
    timeframe,
    status: watchlistStatus,
    triggerNote: newsState === "risk"
      ? "Trendline remains valid, but headline risk keeps the setup in staged mode until volatility settles."
      : closesAggressivelyThroughLine
        ? "Projected line invalidated. Cancel the current trendline and wait for a new two-touch structure."
        : rrBlockedByResistance
          ? direction === "long"
            ? "Trendline is valid but reward is capped by nearby resistance. Hold the setup, do not trigger."
            : "Trendline is valid but reward is capped by nearby support. Hold the setup, do not trigger."
          : confirmation.matches > 0
            ? "Confirmation candle printed at touch 3. Promote into active trade handling."
            : candidateIsNearLine
              ? direction === "long"
                ? "Price is in the touch-3 zone. Wait for hammer, engulfing, doji, or tweezer confirmation."
                : "Price is in the touch-3 zone. Wait for shooting star, bearish engulfing, doji, or tweezer-top confirmation."
              : direction === "long"
                ? "The trendline remains valid, but price has not yet rotated into the third-touch reaction zone."
                : "The trendline remains valid, but price has not yet rotated into the third-touch rejection zone.",
    confluenceState: newsState,
  };

  const events: TradeEvent[] = [
    {
      id: `engine-third-touch-event-1-${marketSymbol}`,
      agentId,
      marketSymbol,
      timestamp: formatEventLabel(window[touch2.barIndex]?.time ?? candidate.time),
      eventTimeSec: window[touch2.barIndex]?.time ?? candidate.time,
      title: "Trendline projected",
      detail:
        direction === "long"
          ? "Two ascending swing lows were locked and projected forward into a live third-touch reaction line."
          : "Two descending swing highs were locked and projected forward into a live third-touch rejection line.",
      stage: "watchlist",
      focusKind: "point",
    },
    {
      id: `engine-third-touch-event-2-${marketSymbol}`,
      agentId,
      marketSymbol,
      timestamp: formatEventLabel(candidate.time),
      eventTimeSec: candidate.time,
      title: "Touch zone active",
      detail: closesAggressivelyThroughLine
        ? direction === "long"
          ? "Price reached the projected line, but the body failed to hold above support."
          : "Price reached the projected line, but the body failed to hold below resistance."
        : candidateIsNearLine
          ? direction === "long"
            ? "Price has approached the projected trendline and the reaction zone is now active."
            : "Price has approached the projected trendline and the rejection zone is now active."
          : "The projected line is still valid, but price has not yet rotated into the touch zone.",
      stage: candidateIsNearLine
        ? status === "watchlist"
          ? "watchlist"
          : "ready"
        : "watchlist",
      focusKind: "area",
    },
    {
      id: `engine-third-touch-event-3-${marketSymbol}`,
      agentId,
      marketSymbol,
      timestamp: formatEventLabel(candidate.time),
      eventTimeSec: candidate.time,
      title: newsState === "risk"
        ? "Risk filter active"
        : closesAggressivelyThroughLine
        ? "Structure invalidated"
        : status === "entered"
          ? direction === "long"
            ? "Bullish trigger confirmed"
            : "Bearish trigger confirmed"
          : rrBlockedByResistance
            ? "Reward path blocked"
            : "Waiting for trigger",
      detail: tradeIdea.thesis,
      stage: closesAggressivelyThroughLine
        ? "watchlist"
        : status === "entered"
          ? "entered"
          : "ready",
      focusKind:
        closesAggressivelyThroughLine || status !== "entered" ? "area" : "point",
    },
  ];

  const zoneLow = projectedLinePrice - touchTolerance;
  const zoneHigh = projectedLinePrice + touchTolerance;

  const trace: VisualTrace = {
    id: `engine-third-touch-trace-${agentId}-${marketSymbol}`,
    agentId,
    marketSymbol,
    timeframe,
    updatedAt: "Engine derived",
    annotations: [
      {
        id: `engine-third-touch-line-${marketSymbol}`,
        type: "trendline",
        label: "Projected trendline",
        detail:
          direction === "long"
            ? "Touch 1 and Touch 2 define the support line projected into the third reaction."
            : "Touch 1 and Touch 2 define the resistance line projected into the third reaction.",
        revealStep: 1,
        geometry: {
          kind: "line",
          start: {
            barIndex: touch1.barIndex,
            timeSec: window[touch1.barIndex]?.time,
            price: touch1.price,
          },
          end: {
            barIndex: candidateBarIndex,
            timeSec: candidate.time,
            price: projectedLinePrice,
          },
          tone: "default",
        },
      },
      {
        id: `engine-third-touch-t1-${marketSymbol}`,
        type: "note",
        label: "Touch 1 anchor",
        detail:
          direction === "long"
            ? "First swing low that began the current upward support structure."
            : "First swing high that began the current downward resistance structure.",
        revealStep: 1,
        geometry: {
          kind: "marker",
          position: {
            barIndex: touch1.barIndex,
            timeSec: window[touch1.barIndex]?.time,
            price: touch1.price,
          },
          text: "T1",
          tone: "muted",
        },
      },
      {
        id: `engine-third-touch-t2-${marketSymbol}`,
        type: "note",
        label: "Touch 2 confirmation",
        detail:
          direction === "long"
            ? "Second higher low confirming the trendline slope."
            : "Second lower high confirming the trendline slope.",
        revealStep: 1,
        geometry: {
          kind: "marker",
          position: {
            barIndex: touch2.barIndex,
            timeSec: window[touch2.barIndex]?.time,
            price: touch2.price,
          },
          text: "T2",
          tone: "muted",
        },
      },
      {
        id: `engine-third-touch-zone-${marketSymbol}`,
        type: "zone",
        label: "Third-touch zone",
        detail:
          direction === "long"
            ? "The current price reaction is judged against this tolerance band around the projected line."
            : "The current price rejection is judged against this tolerance band around the projected line.",
        revealStep: 2,
        geometry: {
          kind: "zone",
          startBarIndex: Math.max(candidateBarIndex - 5, touch2.barIndex),
          endBarIndex: candidateBarIndex,
          startTimeSec:
            window[Math.max(candidateBarIndex - 5, touch2.barIndex)]?.time,
          endTimeSec: candidate.time,
          highPrice: Math.max(zoneHigh, zoneLow),
          lowPrice: Math.min(zoneHigh, zoneLow),
          tone: "zone",
        },
      },
      ...(status === "entered"
        ? [
            {
              id: `engine-third-touch-entry-${marketSymbol}`,
              type: "entry" as const,
              label: "Entry trigger",
              detail:
                direction === "long"
                  ? "Entry is activated on a valid bullish reversal candle at the projected touch."
                  : "Entry is activated on a valid bearish rejection candle at the projected touch.",
              revealStep: 3,
              geometry: {
                kind: "marker" as const,
                position: {
                  barIndex: candidateBarIndex,
                  timeSec: candidate.time,
                  price: proposedEntry,
                },
                text: "Entry",
                tone: "entry" as const,
              },
            },
            {
              id: `engine-third-touch-stop-${marketSymbol}`,
              type: "stop-loss" as const,
              label: "Risk floor",
              detail:
                direction === "long"
                  ? "Stop is set under the previous significant swing low to allow market noise."
                  : "Stop is set above the previous significant swing high to allow market noise.",
              revealStep: 3,
              geometry: {
                kind: "marker" as const,
                position: {
                  barIndex: candidateBarIndex,
                  timeSec: candidate.time,
                  price: proposedStopLoss,
                },
                text: "SL",
                tone: "stop" as const,
              },
            },
            {
              id: `engine-third-touch-target-${marketSymbol}`,
              type: "take-profit" as const,
              label: "1:3 target",
              detail:
                "Target is projected from entry using the strategy's minimum 1:3 reward requirement.",
              revealStep: 3,
              geometry: {
                kind: "marker" as const,
                position: {
                  barIndex: candidateBarIndex,
                  timeSec: candidate.time,
                  price: proposedTakeProfit,
                },
                text: "TP",
                tone: "target" as const,
              },
            },
          ]
        : []),
    ],
  };

  const position =
    status === "entered" && !rrBlockedByResistance && !closesAggressivelyThroughLine
      ? {
          id: `engine-third-touch-position-${agentId}-${marketSymbol}`,
          agentId,
          marketSymbol,
          direction,
          timeframe,
          entry: roundForMarket(marketSymbol, proposedEntry),
          markPrice: roundForMarket(marketSymbol, latest.close),
          stopLoss: roundForMarket(marketSymbol, proposedStopLoss),
          takeProfit: roundForMarket(marketSymbol, proposedTakeProfit),
          pnlPercent: Number(
            (
              ((direction === "long"
                ? latest.close - proposedEntry
                : proposedEntry - latest.close) /
                proposedEntry) *
              100
            ).toFixed(2),
          ),
          progressLabel: "Engine-derived trendline monitoring state",
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
