import type {
  ConfluenceState,
  Position,
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

function roundForMarket(marketSymbol: string, value: number) {
  const decimals = marketSymbol === "EUR/USD" ? 4 : 2;
  return Number(value.toFixed(decimals));
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function findSwingLows(candles: PythCandle[], radius = 2): SwingPoint[] {
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

function findSwingHighs(candles: PythCandle[], radius = 2): SwingPoint[] {
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

export function deriveThirdTouchArenaState({
  agentId,
  marketSymbol,
  timeframe,
  candles,
  newsState = "neutral",
}: ThirdTouchEngineInput): ThirdTouchEngineOutput | null {
  if (candles.length < 45) return null;

  const window = candles.slice(-72);
  const swingLows = findSwingLows(window);
  const swingHighs = findSwingHighs(window);

  if (swingLows.length < 2) return null;

  let touch1: SwingPoint | null = null;
  let touch2: SwingPoint | null = null;

  for (let index = swingLows.length - 1; index > 0; index -= 1) {
    const current = swingLows[index];
    const previous = swingLows[index - 1];

    if (
      current.price > previous.price &&
      current.barIndex - previous.barIndex >= 4 &&
      window
        .slice(current.barIndex, Math.min(window.length, current.barIndex + 10))
        .some((candle) => candle.high > window[previous.barIndex].high)
    ) {
      touch1 = previous;
      touch2 = current;
      break;
    }
  }

  if (!touch1 || !touch2) return null;

  const latest = window[window.length - 1];
  const previous = window[window.length - 2] ?? latest;
  const candidateBarIndex = window.length - 1;
  const projectedLinePrice = getProjectedLinePrice(
    touch1,
    touch2,
    candidateBarIndex,
  );

  const averageRange = average(window.slice(-20).map((candle) => candle.high - candle.low));
  const touchTolerance = Math.max(averageRange * 0.35, projectedLinePrice * 0.0012);
  const bodyTolerance = Math.max(averageRange * 0.18, projectedLinePrice * 0.0006);

  const proximityTouch = Math.abs(latest.low - projectedLinePrice) <= touchTolerance;
  const wickPenetration =
    latest.low < projectedLinePrice - bodyTolerance &&
    latest.close >= projectedLinePrice - bodyTolerance;
  const perfectTouch =
    latest.low <= projectedLinePrice + bodyTolerance &&
    latest.low >= projectedLinePrice - bodyTolerance &&
    latest.close > projectedLinePrice;
  const closesAggressivelyBelow =
    latest.close < projectedLinePrice - touchTolerance &&
    latest.close < latest.open &&
    Math.abs(latest.close - latest.open) >= averageRange * 0.55;

  const confirmation = classifyCandlestickConfirmation(
    previous,
    latest,
    projectedLinePrice,
    touchTolerance,
  );

  const recentResistance =
    swingHighs
      .filter((swing) => swing.barIndex > touch2.barIndex)
      .map((swing) => swing.price)
      .reduce((highest, price) => Math.max(highest, price), latest.high) ?? latest.high;

  const proposedEntry = closesAggressivelyBelow
    ? projectedLinePrice
    : confirmation.matches > 0
      ? latest.close
      : projectedLinePrice;
  const stopAnchor = touch2.price;
  const proposedStopLoss = stopAnchor - touchTolerance * 1.4;
  const riskDistance = proposedEntry - proposedStopLoss;
  const proposedTakeProfit = proposedEntry + riskDistance * 3;
  const rrBlockedByResistance = proposedTakeProfit > recentResistance * 1.01;

  let status: TradeIdea["status"] = "watchlist";
  if ((perfectTouch || wickPenetration || proximityTouch) && !closesAggressivelyBelow) {
    status = confirmation.matches > 0 && !rrBlockedByResistance ? "entered" : "ready";
  }

  if (newsState === "risk" && status === "entered") {
    status = "ready";
  }

  const watchlistStatus: WatchlistItem["status"] =
    status === "watchlist" ? "watching" : "armed";

  const confidence = closesAggressivelyBelow
    ? 0.31
    : status === "entered"
      ? 0.76 + Math.min(confirmation.matches, 2) * 0.04
      : status === "ready"
        ? 0.66
        : 0.54;

  const triggerSummary = closesAggressivelyBelow
    ? "A bearish body closed beneath the projected line and invalidated the touch."
    : confirmation.matches > 1
      ? "Multiple bullish confirmation patterns printed at the projected third touch."
      : confirmation.matches === 1
        ? "A valid bullish trigger printed on the projected third-touch reaction."
        : "Price is now sitting on the projected third-touch zone and waiting for a confirmation candle.";

  const tradeIdea: TradeIdea = {
    id: `engine-third-touch-idea-${agentId}-${marketSymbol}`,
    agentId,
    marketSymbol,
    direction: "long",
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
        : closesAggressivelyBelow
          ? "The projected third-touch line failed because price closed aggressively below support."
          : rrBlockedByResistance
            ? "The third-touch structure is valid, but nearby overhead resistance does not leave a clean 1:3 reward path yet."
            : triggerSummary,
  };

  const watchlistItem: WatchlistItem = {
    id: `engine-third-touch-watch-${agentId}-${marketSymbol}`,
    agentId,
    marketSymbol,
    setupLabel: "Projected third touch on ascending trendline",
    timeframe,
    status: watchlistStatus,
    triggerNote: newsState === "risk"
      ? "Trendline remains valid, but headline risk keeps the setup in staged mode until volatility settles."
      : closesAggressivelyBelow
        ? "Projected line invalidated. Cancel the current trendline and wait for a new two-touch structure."
        : rrBlockedByResistance
          ? "Trendline is valid but reward is capped by nearby resistance. Hold the setup, do not trigger."
          : confirmation.matches > 0
            ? "Confirmation candle printed at touch 3. Promote into active trade handling."
            : "Price is in the touch-3 zone. Wait for hammer, engulfing, doji, or tweezer confirmation.",
    confluenceState: newsState,
  };

  const events: TradeEvent[] = [
    {
      id: `engine-third-touch-event-1-${marketSymbol}`,
      agentId,
      marketSymbol,
      timestamp: "step 1",
      title: "Trendline projected",
      detail:
        "Two ascending swing lows were locked and projected forward into a live third-touch reaction line.",
      stage: "watchlist",
    },
    {
      id: `engine-third-touch-event-2-${marketSymbol}`,
      agentId,
      marketSymbol,
      timestamp: "step 2",
      title: "Touch zone active",
      detail: closesAggressivelyBelow
        ? "Price reached the projected line, but the body failed to hold above support."
        : "Price has approached the projected trendline and the reaction zone is now active.",
      stage: status === "watchlist" ? "watchlist" : "ready",
    },
    {
      id: `engine-third-touch-event-3-${marketSymbol}`,
      agentId,
      marketSymbol,
      timestamp: "step 3",
      title: newsState === "risk"
        ? "Risk filter active"
        : closesAggressivelyBelow
        ? "Structure invalidated"
        : status === "entered"
          ? "Bullish trigger confirmed"
          : rrBlockedByResistance
            ? "Reward path blocked"
            : "Waiting for trigger",
      detail: tradeIdea.thesis,
      stage: closesAggressivelyBelow
        ? "watchlist"
        : status === "entered"
          ? "entered"
          : "ready",
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
        detail: "Touch 1 and Touch 2 define the support line projected into the third reaction.",
        revealStep: 1,
        geometry: {
          kind: "line",
          start: {
            barIndex: touch1.barIndex,
            price: touch1.price,
          },
          end: {
            barIndex: candidateBarIndex,
            price: projectedLinePrice,
          },
          tone: "default",
        },
      },
      {
        id: `engine-third-touch-t1-${marketSymbol}`,
        type: "note",
        label: "Touch 1 anchor",
        detail: "First swing low that began the current upward support structure.",
        revealStep: 1,
        geometry: {
          kind: "marker",
          position: {
            barIndex: touch1.barIndex,
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
        detail: "Second higher low confirming the trendline slope.",
        revealStep: 1,
        geometry: {
          kind: "marker",
          position: {
            barIndex: touch2.barIndex,
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
        detail: "The current price reaction is judged against this tolerance band around the projected line.",
        revealStep: 2,
        geometry: {
          kind: "zone",
          startBarIndex: Math.max(candidateBarIndex - 5, touch2.barIndex),
          endBarIndex: candidateBarIndex,
          highPrice: zoneHigh,
          lowPrice: zoneLow,
          tone: "zone",
        },
      },
      {
        id: `engine-third-touch-entry-${marketSymbol}`,
        type: "entry",
        label: "Entry trigger",
        detail: "Entry is activated on a valid bullish reversal candle at the projected touch.",
        revealStep: 3,
        geometry: {
          kind: "marker",
          position: {
            barIndex: candidateBarIndex,
            price: proposedEntry,
          },
          text: "Entry",
          tone: "entry",
        },
      },
      {
        id: `engine-third-touch-stop-${marketSymbol}`,
        type: "stop-loss",
        label: "Risk floor",
        detail: "Stop is set under the previous significant swing low to allow market noise.",
        revealStep: 3,
        geometry: {
          kind: "marker",
          position: {
            barIndex: touch2.barIndex,
            price: proposedStopLoss,
          },
          text: "SL",
          tone: "stop",
        },
      },
      {
        id: `engine-third-touch-target-${marketSymbol}`,
        type: "take-profit",
        label: "1:3 target",
        detail: "Target is projected from entry using the strategy's minimum 1:3 reward requirement.",
        revealStep: 3,
        geometry: {
          kind: "marker",
          position: {
            barIndex: candidateBarIndex,
            price: proposedTakeProfit,
          },
          text: "TP",
          tone: "target",
        },
      },
    ],
  };

  const position =
    status === "entered" && !rrBlockedByResistance && !closesAggressivelyBelow
      ? {
          id: `engine-third-touch-position-${agentId}-${marketSymbol}`,
          agentId,
          marketSymbol,
          direction: "long" as const,
          timeframe,
          entry: roundForMarket(marketSymbol, proposedEntry),
          markPrice: roundForMarket(marketSymbol, latest.close),
          stopLoss: roundForMarket(marketSymbol, proposedStopLoss),
          takeProfit: roundForMarket(marketSymbol, proposedTakeProfit),
          pnlPercent: Number(
            ((((latest.close - proposedEntry) / proposedEntry) * 100).toFixed(2)),
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
