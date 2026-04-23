import type {
  Agent,
  Market,
  NewsContext,
  Position,
  TradeEvent,
  TradeIdea,
  VisualTrace,
  WatchlistItem,
} from "@/lib/arena-types";

export const agents: Agent[] = [
  {
    id: "fibonacci-trend",
    name: "Fibonacci Trend",
    strategyLabel: "Trend continuation",
    status: "monitoring",
    primaryMarket: "XAU/USD",
    timeframe: "15m",
    winRate: 61,
    pnlPercent: 8.4,
    openPositions: 1,
    score: 1240,
    lastAction: "Monitoring long after second candle check.",
  },
  {
    id: "third-touch",
    name: "Third Touch",
    strategyLabel: "Trendline reaction",
    status: "watchlist",
    primaryMarket: "XAG/USD",
    timeframe: "1h",
    winRate: 57,
    pnlPercent: 5.9,
    openPositions: 0,
    score: 1118,
    lastAction: "Watchlist active while price approaches projected touch.",
  },
];

export const markets: Market[] = [
  {
    symbol: "XAU/USD",
    displayName: "Gold",
    assetClass: "commodity",
    price: 2334.82,
    changePercent: 0.72,
    dailyRange: "2320.10 - 2341.60",
    sessionBias: "bullish",
  },
  {
    symbol: "XAG/USD",
    displayName: "Silver",
    assetClass: "commodity",
    price: 27.44,
    changePercent: -0.18,
    dailyRange: "27.18 - 27.61",
    sessionBias: "mixed",
  },
  {
    symbol: "EUR/USD",
    displayName: "Euro / US Dollar",
    assetClass: "forex",
    price: 1.0714,
    changePercent: 0.11,
    dailyRange: "1.0688 - 1.0726",
    sessionBias: "mixed",
  },
];

export const newsContexts: NewsContext[] = [
  {
    id: "news-1",
    marketSymbol: "XAU/USD",
    headline: "Dollar softens ahead of US data window",
    state: "supportive",
    sourceLabel: "Macro desk",
    publishedAt: "12m ago",
    note: "Supports current long bias but does not replace entry confirmation.",
  },
  {
    id: "news-2",
    marketSymbol: "XAG/USD",
    headline: "No major catalyst in current session",
    state: "neutral",
    sourceLabel: "Market pulse",
    publishedAt: "28m ago",
    note: "Technical setup remains valid without strong headline influence.",
  },
  {
    id: "news-3",
    marketSymbol: "EUR/USD",
    headline: "Speakers scheduled later in New York overlap",
    state: "risk",
    sourceLabel: "Calendar risk",
    publishedAt: "41m ago",
    note: "High-impact commentary could delay entries on this pair.",
  },
];

export const watchlistItems: WatchlistItem[] = [
  {
    id: "watch-1",
    agentId: "third-touch",
    marketSymbol: "XAG/USD",
    setupLabel: "Projected third touch near descending line",
    timeframe: "1h",
    status: "watching",
    triggerNote: "Needs clean rejection wick at touch zone before arming.",
    confluenceState: "neutral",
  },
  {
    id: "watch-2",
    agentId: "fibonacci-trend",
    marketSymbol: "EUR/USD",
    setupLabel: "Retracement into premium discount band",
    timeframe: "15m",
    status: "armed",
    triggerNote: "News risk is elevated, hold until post-event volatility settles.",
    confluenceState: "risk",
  },
];

export const tradeIdeas: TradeIdea[] = [
  {
    id: "idea-1",
    agentId: "fibonacci-trend",
    marketSymbol: "XAU/USD",
    direction: "long",
    status: "entered",
    entry: 2330.4,
    stopLoss: 2323.8,
    takeProfit: 2349.6,
    confidence: 0.82,
    confluenceState: "supportive",
    thesis:
      "Structure remains intact after retracement into fib zone with bullish follow-through.",
  },
  {
    id: "idea-2",
    agentId: "third-touch",
    marketSymbol: "XAG/USD",
    direction: "short",
    status: "watchlist",
    entry: 27.58,
    stopLoss: 27.76,
    takeProfit: 27.14,
    confidence: 0.64,
    confluenceState: "neutral",
    thesis:
      "Trendline reaction is developing, but entry waits on a cleaner touch and close.",
  },
];

export const positions: Position[] = [
  {
    id: "position-1",
    agentId: "fibonacci-trend",
    marketSymbol: "XAU/USD",
    direction: "long",
    timeframe: "15m",
    entry: 2330.4,
    markPrice: 2337.9,
    stopLoss: 2323.8,
    takeProfit: 2349.6,
    pnlPercent: 0.32,
    progressLabel: "38% to take profit",
    nextCheckIn: "in 9m",
  },
];

export const tradeEvents: TradeEvent[] = [
  {
    id: "event-1",
    agentId: "fibonacci-trend",
    marketSymbol: "XAU/USD",
    timestamp: "09:12",
    title: "Watchlist armed",
    detail: "Retracement reached the 0.618 zone with market structure preserved.",
    stage: "ready",
  },
  {
    id: "event-2",
    agentId: "fibonacci-trend",
    marketSymbol: "XAU/USD",
    timestamp: "09:28",
    title: "Entry marked",
    detail: "Bullish confirmation candle closed above the trigger level.",
    stage: "entered",
  },
  {
    id: "event-3",
    agentId: "fibonacci-trend",
    marketSymbol: "XAU/USD",
    timestamp: "09:58",
    title: "Monitoring cycle",
    detail: "Second 15m candle completed. Position remains within thesis.",
    stage: "monitoring",
  },
  {
    id: "event-4",
    agentId: "third-touch",
    marketSymbol: "XAG/USD",
    timestamp: "10:04",
    title: "Trendline projected",
    detail: "Touch one and two locked. Price is approaching the reaction zone.",
    stage: "watchlist",
  },
];

export const visualTraces: VisualTrace[] = [
  {
    id: "trace-1",
    agentId: "fibonacci-trend",
    marketSymbol: "XAU/USD",
    timeframe: "15m",
    updatedAt: "Updated 2m ago",
    annotations: [
      {
        id: "annotation-1",
        type: "fibonacci",
        label: "Retracement mapped",
        detail: "Swing low to swing high is locked for the current continuation leg.",
      },
      {
        id: "annotation-2",
        type: "zone",
        label: "0.618 reaction zone",
        detail: "Entry interest held after the first bullish response inside the zone.",
      },
      {
        id: "annotation-3",
        type: "entry",
        label: "Long trigger marked",
        detail: "Confirmation candle close converted the idea into an entered trade.",
      },
      {
        id: "annotation-4",
        type: "take-profit",
        label: "Target extension",
        detail: "Take profit aligned with prior impulse expansion and session range ceiling.",
      },
    ],
  },
  {
    id: "trace-2",
    agentId: "third-touch",
    marketSymbol: "XAG/USD",
    timeframe: "1h",
    updatedAt: "Updated 5m ago",
    annotations: [
      {
        id: "annotation-5",
        type: "trendline",
        label: "Descending line anchored",
        detail: "Touch one and touch two are fixed for projected third-touch logic.",
      },
      {
        id: "annotation-6",
        type: "zone",
        label: "Reaction pocket",
        detail: "Price needs to reject here before the watchlist advances to ready.",
      },
    ],
  },
];
