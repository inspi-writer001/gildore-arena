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

export function deriveFibonacciArenaState({
  agentId,
  marketSymbol,
  timeframe,
  candles,
  newsState = "neutral",
}: FibonacciEngineInput): FibonacciEngineOutput | null {
  if (candles.length < 30) return null;

  const window = candles.slice(-48);
  const pivotSplitIndex = Math.max(8, Math.floor(window.length * 0.45));

  let lowIndex = 0;
  for (let index = 1; index < pivotSplitIndex; index += 1) {
    if (window[index].low < window[lowIndex].low) {
      lowIndex = index;
    }
  }

  let highIndex = lowIndex + 1;
  for (let index = lowIndex + 1; index < window.length; index += 1) {
    if (window[index].high > window[highIndex].high) {
      highIndex = index;
    }
  }

  if (highIndex <= lowIndex) return null;

  const swingLow = window[lowIndex].low;
  const swingHigh = window[highIndex].high;
  const range = swingHigh - swingLow;

  if (range <= 0) return null;

  const zoneHigh = swingHigh - range * 0.618;
  const zoneLow = swingHigh - range * 0.7;
  const entry = (zoneHigh + zoneLow) / 2;
  const stopLoss = zoneLow - range * 0.12;
  const takeProfit = swingHigh + range * 0.382;

  const latest = window[window.length - 1];
  const previous = window[window.length - 2] ?? latest;
  const lowTimeSec = window[lowIndex]?.time;
  const highTimeSec = window[highIndex]?.time;
  const zoneStartIndex = Math.max(highIndex - 8, 0);
  const zoneStartTimeSec = window[zoneStartIndex]?.time;
  const latestTimeSec = latest.time;

  let status: TradeIdea["status"] = "watchlist";
  if (latest.close >= zoneLow && latest.close <= zoneHigh) {
    status = "ready";
  } else if (latest.close > zoneHigh && previous.close <= zoneHigh) {
    status = "entered";
  } else if (latest.close > swingHigh) {
    status = "entered";
  }

  if (newsState === "risk" && status === "entered") {
    status = "ready";
  }

  const triggerBarIndex =
    status === "entered"
      ? window.length - 1
      : latest.close >= zoneLow && latest.close <= zoneHigh
        ? window.length - 1
        : highIndex;
  const triggerTimeSec = window[triggerBarIndex]?.time ?? latestTimeSec;

  const tradeIdea: TradeIdea = {
    id: `engine-idea-${agentId}-${marketSymbol}`,
    agentId,
    marketSymbol,
    direction: "long",
    status,
    entry: roundForMarket(marketSymbol, entry),
    stopLoss: roundForMarket(marketSymbol, stopLoss),
    takeProfit: roundForMarket(marketSymbol, takeProfit),
    confidence: Number(
      (
        (status === "entered" ? 0.79 : status === "ready" ? 0.71 : 0.63) +
        (newsState === "supportive" ? 0.04 : newsState === "risk" ? -0.08 : 0)
      ).toFixed(2),
    ),
    confluenceState: newsState,
    thesis:
      newsState === "risk"
        ? "The Fibonacci structure is valid, but the current news context raises event risk, so the setup remains staged instead of entered."
        : status === "entered"
        ? "Live candles reclaimed the Fibonacci reaction band and continued through the trigger."
        : status === "ready"
          ? "Price is trading inside the Fibonacci reaction band and is waiting for confirmation."
          : "The continuation leg is mapped, but price has not yet rotated into the reaction band.",
  };

  const events: TradeEvent[] = [
    {
      id: `engine-event-1-${marketSymbol}`,
      agentId,
      marketSymbol,
      timestamp: formatEventLabel(highTimeSec),
      eventTimeSec: highTimeSec,
      title: "Retracement mapped",
      detail: "Swing low and swing high were detected from the recent continuation window.",
      stage: "watchlist",
      focusKind: "area",
    },
    {
      id: `engine-event-2-${marketSymbol}`,
      agentId,
      marketSymbol,
      timestamp: formatEventLabel(latestTimeSec),
      eventTimeSec: latestTimeSec,
      title: "Reaction band tracked",
      detail: "The 0.618 to 0.700 retracement band is now active for a long continuation setup.",
      stage: status === "watchlist" ? "watchlist" : "ready",
      focusKind: "area",
    },
    {
      id: `engine-event-3-${marketSymbol}`,
      agentId,
      marketSymbol,
      timestamp: formatEventLabel(triggerTimeSec),
      eventTimeSec: triggerTimeSec,
      title:
        newsState === "risk"
          ? "Risk filter active"
          : status === "entered"
            ? "Entry confirmed"
            : "Setup still waiting",
      detail:
        newsState === "risk"
          ? "Price action is valid, but the current headline regime keeps this setup in staged mode."
          : status === "entered"
          ? "Price closed back through the trigger and promoted the setup into an entered trade."
          : "The chart remains tracked, but the trigger has not confirmed an entry yet.",
      stage: status === "entered" ? "entered" : "ready",
      focusKind: status === "entered" ? "point" : "area",
    },
  ];

  const watchlistItem: WatchlistItem = {
    id: `engine-watch-${agentId}-${marketSymbol}`,
    agentId,
    marketSymbol,
    setupLabel: "Fibonacci continuation reaction",
    timeframe,
    status: status === "watchlist" ? "watching" : "armed",
    triggerNote:
      status === "entered"
        ? "Setup has already triggered from the retracement band."
        : "Track the reaction band for confirmation into continuation.",
    confluenceState: newsState,
  };

  const trace: VisualTrace = {
    id: `engine-trace-${agentId}-${marketSymbol}`,
    agentId,
    marketSymbol,
    timeframe,
    updatedAt: "Engine derived",
    annotations: [
      {
        id: `engine-fib-${marketSymbol}`,
        type: "fibonacci",
        label: "Retracement mapped",
        detail: "Engine-derived swing anchors define the current continuation leg.",
        revealStep: 1,
        geometry: {
          kind: "fibonacci",
          startBarIndex: lowIndex,
          endBarIndex: highIndex,
          startTimeSec: lowTimeSec,
          endTimeSec: highTimeSec,
          highPrice: swingHigh,
          lowPrice: swingLow,
          levels: [0, 0.5, 0.618, 0.7, 1],
        },
      },
      {
        id: `engine-zone-${marketSymbol}`,
        type: "zone",
        label: "Reaction band",
        detail: "The active continuation zone spans the 0.618 to 0.700 retracement band.",
        revealStep: 2,
        geometry: {
          kind: "zone",
          startBarIndex: zoneStartIndex,
          endBarIndex: window.length - 1,
          startTimeSec: zoneStartTimeSec,
          endTimeSec: latestTimeSec,
          highPrice: zoneHigh,
          lowPrice: zoneLow,
          tone: "zone",
        },
      },
      ...(status === "entered"
        ? [
            {
              id: `engine-entry-${marketSymbol}`,
              type: "entry" as const,
              label: "Trigger level",
              detail:
                "The engine marks the midpoint of the reaction band as the confirmed trigger.",
              revealStep: 3,
              geometry: {
                kind: "marker" as const,
                position: {
                  barIndex: triggerBarIndex,
                  timeSec: triggerTimeSec,
                  price: entry,
                },
                text: "Entry",
                tone: "entry" as const,
              },
            },
            {
              id: `engine-stop-${marketSymbol}`,
              type: "stop-loss" as const,
              label: "Risk line",
              detail:
                "Stop sits below the reaction band to protect the retracement failure case.",
              revealStep: 3,
              geometry: {
                kind: "marker" as const,
                position: {
                  barIndex: triggerBarIndex,
                  timeSec: triggerTimeSec,
                  price: stopLoss,
                },
                text: "SL",
                tone: "stop" as const,
              },
            },
            {
              id: `engine-target-${marketSymbol}`,
              type: "take-profit" as const,
              label: "Extension target",
              detail:
                "Target projects beyond the swing high using a continuation extension.",
              revealStep: 3,
              geometry: {
                kind: "marker" as const,
                position: {
                  barIndex: triggerBarIndex,
                  timeSec: triggerTimeSec,
                  price: takeProfit,
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
          progressLabel: "Engine-derived monitoring state",
          nextCheckIn: timeframe === "15m" ? "in 30m" : timeframe === "1h" ? "in 2h" : "in 8h",
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
