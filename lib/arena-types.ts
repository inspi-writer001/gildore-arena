export type TradeTimeframe = "15m" | "1h" | "4h";
export type BrowserSessionStatus =
  | "starting"
  | "loading_chart"
  | "switching_symbol"
  | "switching_timeframe"
  | "ready"
  | "failed"
  | "completed";

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
  newsState?: ConfluenceState;
  newsRationale?: string;
  newsUpdatedAt?: number;
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
  eventTimeSec?: number;
  title: string;
  detail: string;
  stage: AgentStatus;
  focusKind?: "point" | "area";
};

export type VisualChartPoint = {
  barIndex: number;
  timeSec?: number;
  price: number;
};

export type VisualTone =
  | "default"
  | "muted"
  | "entry"
  | "stop"
  | "target"
  | "zone";

export type VisualGeometry =
  | {
      kind: "line";
      start: VisualChartPoint;
      end: VisualChartPoint;
      tone?: VisualTone;
    }
  | {
      kind: "fibonacci";
      startBarIndex: number;
      endBarIndex: number;
      startTimeSec?: number;
      endTimeSec?: number;
      highPrice: number;
      lowPrice: number;
      levels?: number[];
      tone?: VisualTone;
    }
  | {
      kind: "zone";
      startBarIndex: number;
      endBarIndex: number;
      startTimeSec?: number;
      endTimeSec?: number;
      highPrice: number;
      lowPrice: number;
      tone?: VisualTone;
    }
  | {
      kind: "marker";
      position: VisualChartPoint;
      text: string;
      tone?: VisualTone;
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
  geometry?: VisualGeometry;
  revealStep?: number;
};

export type VisualTrace = {
  id: string;
  agentId: string;
  marketSymbol: string;
  timeframe: TradeTimeframe;
  updatedAt: string;
  annotations: VisualAnnotation[];
};

export type BrowserSession = {
  id: string;
  agentId: string;
  marketSymbol: string;
  timeframe: TradeTimeframe;
  browserTargetSymbol?: string;
  browserTargetTimeframe?: string;
  inspectedOn: "deriv";
  targetUrl: string;
  status: BrowserSessionStatus;
  currentStepLabel: string;
  currentStepIndex: number;
  totalSteps: number;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: string;
};

export type BrowserSessionEvent = {
  id: string;
  sessionId: string;
  sequence: number;
  label: string;
  detail: string;
  status: "queued" | "running" | "completed" | "failed";
};
