export type TradeTimeframe = "15m" | "1h" | "4h";

export type AgentStatus =
  | "scanning"
  | "watchlist"
  | "ready"
  | "entered"
  | "monitoring"
  | "closed";

export type ConfluenceState = "supportive" | "neutral" | "risk";

export type TradeDirection = "long" | "short";

export type Agent = {
  id: string;
  name: string;
  strategyLabel: string;
  status: AgentStatus;
  primaryMarket: string;
  timeframe: TradeTimeframe;
  winRate: number;
  pnlPercent: number;
  openPositions: number;
  score: number;
  lastAction: string;
};

export type Market = {
  symbol: string;
  displayName: string;
  assetClass: "commodity" | "forex";
  price: number;
  changePercent: number;
  dailyRange: string;
  sessionBias: "bullish" | "bearish" | "mixed";
};

export type NewsContext = {
  id: string;
  marketSymbol: string;
  headline: string;
  state: ConfluenceState;
  sourceLabel: string;
  publishedAt: string;
  note: string;
};

export type WatchlistItem = {
  id: string;
  agentId: string;
  marketSymbol: string;
  setupLabel: string;
  timeframe: TradeTimeframe;
  status: "watching" | "armed";
  triggerNote: string;
  confluenceState: ConfluenceState;
};

export type TradeIdea = {
  id: string;
  agentId: string;
  marketSymbol: string;
  direction: TradeDirection;
  status: "watchlist" | "ready" | "entered" | "closed";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  confluenceState: ConfluenceState;
  thesis: string;
};

export type Position = {
  id: string;
  agentId: string;
  marketSymbol: string;
  direction: TradeDirection;
  timeframe: TradeTimeframe;
  entry: number;
  markPrice: number;
  stopLoss: number;
  takeProfit: number;
  pnlPercent: number;
  progressLabel: string;
  nextCheckIn: string;
};

export type TradeEvent = {
  id: string;
  agentId: string;
  marketSymbol: string;
  timestamp: string;
  title: string;
  detail: string;
  stage: AgentStatus;
};

export type VisualAnnotation = {
  id: string;
  type:
    | "trendline"
    | "fibonacci"
    | "zone"
    | "entry"
    | "stop-loss"
    | "take-profit"
    | "note";
  label: string;
  detail: string;
};

export type VisualTrace = {
  id: string;
  agentId: string;
  marketSymbol: string;
  timeframe: TradeTimeframe;
  updatedAt: string;
  annotations: VisualAnnotation[];
};
