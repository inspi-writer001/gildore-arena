# Gildore Arena Research: Agentic Strategy Trading Backend

Date: 2026-04-23

## Current Direction

Gildore Arena starts as an agentic trading research system where strategy agents scan commodity and FX-style markets, mark markets of interest, wait for valid entries, record simulated trade plans, monitor open trades on a timeframe-aware schedule, and build public performance records.

This document supersedes the older `gildore-frontend/beta/agentic-research.md` where it conflicts with the new direction. The older leaderboard, season, and agent profile ideas still apply, but the MVP is no longer a generic arena of many agent archetypes. The MVP launches with only the two strategy definitions in `strategies/*.md`.

## Non-Negotiables

- Do not modify `strategies/*.md`.
- Launch with only:
  - `strategies/fibs-trend.md`
  - `strategies/third-touch.md`
- Agents do not execute real-money trades in the MVP.
- Agents mark trade state in the backend: watchlist, ready, entered, monitoring, exited, invalidated.
- Every trade idea must include a technical thesis.
- Agents check current market news for confluence before entry.
- If no strong market news exists, the agent may still proceed using technical analysis alone.
- Every entry must include stop loss and take profit levels.
- Baseline risk/reward requirement is 1:3.
- Trading decisions must be inspectable through logs, not hidden behind opaque agent behavior.
- Users must be able to visually inspect what an agent is doing at every meaningful step.
- Score commitments stay in Convex for now.

## One-Line Concept

Gildore Arena is an agentic strategy lab where trading agents convert structured price-action strategies into watchlisted setups, simulated entries, monitored positions, and ranked trading records across commodities and FX-style markets.

## Product Thesis

The first useful version is not an on-chain exchange. It is a backend-driven research and simulation system that proves whether agents can follow explicit trading strategies, combine technical analysis with market-news confluence, and maintain disciplined trade lifecycle tracking.

The product should feel like watching serious trading agents build a public track record:

1. The agent scans markets.
2. The agent notices a market of interest.
3. The agent adds it to a watchlist with a reason.
4. The agent waits for strategy conditions.
5. The agent marks a trade as entered only when entry rules are satisfied.
6. The agent records entry, stop loss, take profit, timeframe, and thesis.
7. The agent checks the trade at intervals derived from its timeframe.
8. The backend updates PnL, trade status, stats, and leaderboard rank.
9. The UI renders the agent's working state on a chart so users can inspect the exact lines, levels, zones, candles, and decisions.

## Research Notes

- Perpolator describes itself as a permissionless perpetual futures protocol on Solana where users can launch leveraged markets for SPL tokens with configurable leverage, vAMM liquidity, and oracle support including DEX oracle, Pyth V2, and authority-pushed prices: https://perpolator.com/docs
- Percolator references describe a sharded Solana perpetual exchange design with router and slab programs, portfolio margin, cross-slab routing, and ongoing development toward testnet/mainnet readiness: https://www.perpetualexchangeprotocol.xyz/
- Drip positions itself as a trading terminal powered by the Percolator engine with live perp markets, TP/SL, margin controls, Pyth oracles, and charting: https://www.tradedrip.xyz/

These are future execution references only. Gildore Arena should not depend on any live perp venue until the simulated Convex-backed agent loop is stable, testable, and auditable.

## MVP Strategy Set

### Fibonacci Trend Continuation Agent

Source: `strategies/fibs-trend.md`

The agent looks for bullish trend continuation trades in an established uptrend.

Core behavior:

- Parse OHLCV data.
- Confirm bullish market structure through higher highs and higher lows.
- Draw Fibonacci from swing low to swing high.
- Watch the 0.5, 0.618, and 0.7 retracement zones.
- Weight the Fibonacci level that the market has respected across recent historical swings.
- Drop from macro timeframe to micro timeframe for confirmation.
- Enter only after bullish candlestick confirmation inside the Fibonacci zone.
- Use 1:3 minimum risk/reward.
- Place stop loss below the relevant swing low or confirmation wick.

### Third Touch Trendline Agent

Source: `strategies/third-touch.md`

The agent looks for **trend-aligned third-touch reactions**, not only bullish continuations.

Core behavior:

- Parse OHLCV data.
- Use a **wide context window** before drawing anything meaningful.
- Detect **regime first**:
  - bullish
  - bearish
  - mixed
- In bullish regime:
  - build ascending support from swing lows
  - seek long third-touch continuation
- In bearish regime:
  - build descending resistance from swing highs
  - seek short third-touch continuation
- In mixed regime:
  - skip the setup instead of forcing a line
- Use **broader structural swings**, not tiny local pivots.
- Treat the third touch as a **zone around the projected line**, not a single price.
- Invalidate on **candle body** failure, not wick noise alone.
- If the line is invalidated after `T2`, promote the **first invalidating candle body** into the new `T2`, redraw the line, and re-project the next touch zone.
- Enter only after direction-appropriate candlestick confirmation at the third touch.
- Use 1:3 minimum risk/reward.
- Keep staged if risk/reward is blocked or headline risk is elevated.

## Agent News Confluence

Each agent should check current news before marking a setup as ready to enter.

News is not the primary strategy. It is a confluence layer.

The news check should answer:

- Is there active market-moving news for the commodity, currency, or macro driver?
- Does the news support, conflict with, or have no clear relationship to the technical setup?
- Is the news high impact enough to delay entry because of volatility risk?
- Is there an upcoming event window, such as CPI, FOMC, central bank speech, jobs data, inventory report, or geopolitical shock?

Possible news classifications:

```ts
type NewsConfluence =
  | "supports_trade"
  | "conflicts_with_trade"
  | "neutral_or_no_clear_news"
  | "high_impact_event_risk";
```

MVP decision rule:

- `supports_trade`: increase confidence and allow entry if technical rules pass.
- `neutral_or_no_clear_news`: allow entry if technical rules pass.
- `conflicts_with_trade`: reduce confidence; require stronger technical confirmation.
- `high_impact_event_risk`: do not enter immediately; keep or move to watchlist.

## Trade Lifecycle

### State Machine

```ts
type TradeIdeaStatus =
  | "scanning"
  | "watchlisted"
  | "ready_to_enter"
  | "entered"
  | "monitoring"
  | "take_profit_hit"
  | "stop_loss_hit"
  | "manually_closed"
  | "invalidated"
  | "expired";
```

### Lifecycle Steps

1. `scanning`
   - Agent loads market data, candles, current price, and recent news.
   - Agent checks if the market fits one of its strategy setups.

2. `watchlisted`
   - Agent sees a market of interest but no valid entry yet.
   - Backend stores market, strategy, timeframe, expected zone, and watch reason.

3. `ready_to_enter`
   - Price reaches the setup zone.
   - News confluence is checked.
   - Candlestick confirmation is either present or imminent.

4. `entered`
   - Agent marks simulated trade as entered.
   - Backend stores side, entry price, stop loss, take profit, risk/reward, size, and thesis.

5. `monitoring`
   - Backend updates mark price, unrealized PnL, percent in profit/loss, distance to SL, and distance to TP.
   - Agent rechecks at a schedule based on the trade timeframe.

6. Exit states
   - `take_profit_hit`
   - `stop_loss_hit`
   - `manually_closed`
   - `invalidated`
   - `expired`

## Timeframe-Aware Monitoring

Monitoring should be based on the timeframe used for execution.

Rule of thumb:

```text
monitoring interval = execution timeframe * 2 candles
```

Examples:

- 5m trade: check every 10 minutes.
- 15m trade: check every 30 minutes.
- 1h trade: check every 2 hours.
- 4h trade: check every 8 hours.

The agent can still receive backend risk alerts sooner if price hits stop loss or take profit.

```ts
type Timeframe = "5m" | "15m" | "30m" | "1h" | "4h" | "1d";

type MonitoringPolicy = {
  timeframe: Timeframe;
  candleCheckMultiple: 2;
  intervalMinutes: number;
  allowImmediateSlTpDetection: boolean;
};
```

## Agent Visual Trace

Users should be able to see what an agent is doing at every meaningful point in the lifecycle. The product should not only say "Fibonacci agent is watching XAU/USD"; it should show the actual chart state the agent is using.

The UI should render a chart/canvas workspace for each active scan, watchlist setup, and entered trade.

### Visual Requirements

For the Fibonacci Trend Continuation agent, show:

- Candles for the selected market and timeframe.
- Swing low anchor.
- Swing high anchor.
- Fibonacci draw direction.
- 0.5, 0.618, and 0.7 retracement levels.
- Highlighted high-probability entry zone.
- Confirmation candle or pattern cluster.
- Entry marker.
- Stop loss line.
- Take profit line.
- Current mark price.
- Invalidated zone if the setup fails.

For the Third Touch Trendline agent, show:

- Candles for the selected market and timeframe.
- Touch 1 swing low.
- Touch 2 higher swing low.
- Projected trendline.
- Expected third-touch area.
- Valid wick touch, proximity touch, or fake-out marker.
- Body close invalidation marker if price breaks the trendline.
- Confirmation candle or pattern cluster.
- Entry marker.
- Stop loss line.
- Take profit line.
- Current mark price.

For news confluence, show:

- News status label: supports, conflicts, neutral, or high-impact risk.
- Relevant headline summary.
- Time since published.
- Whether news changed the agent's confidence or blocked entry.

### How This Should Be Done

The backend should not send only natural-language explanations. It should emit structured chart annotations that the frontend can render deterministically.

The agent detector produces `VisualTrace` records as it works. The frontend subscribes to these records through Convex and paints them over a candlestick chart.

Recommended rendering approach:

- Use a candlestick charting library with custom overlay support for production.
- Use a canvas or SVG overlay for agent drawings.
- Keep all drawing objects in backend state so the trace is replayable.
- Treat the canvas as a visualization of backend facts, not as the source of truth.

Possible libraries to evaluate during implementation:

- TradingView Lightweight Charts for candlesticks and price scales.
- A custom SVG overlay for fib levels, trendlines, zones, markers, SL, and TP.
- Canvas only if performance becomes an issue with many candles or many active traces.

### Visual Trace Data Model

```ts
type VisualTraceStatus =
  | "active"
  | "superseded"
  | "entered"
  | "invalidated"
  | "closed";

type ChartPoint = {
  time: string;
  price: number;
};

type VisualAnnotation =
  | {
      type: "swing_point";
      label: "swing_low" | "swing_high" | "touch_1" | "touch_2" | "touch_3";
      point: ChartPoint;
      reason: string;
    }
  | {
      type: "trendline";
      label: string;
      from: ChartPoint;
      to: ChartPoint;
      projected: boolean;
      reason: string;
    }
  | {
      type: "fib_retracement";
      from: ChartPoint;
      to: ChartPoint;
      levels: {
        level: 0.5 | 0.618 | 0.7;
        price: number;
        weight: "low" | "medium" | "high";
      }[];
      reason: string;
    }
  | {
      type: "price_zone";
      label: "entry_zone" | "invalidation_zone" | "take_profit_zone";
      low: number;
      high: number;
      startTime: string;
      endTime?: string;
      reason: string;
    }
  | {
      type: "horizontal_level";
      label: "entry" | "stop_loss" | "take_profit" | "mark_price";
      price: number;
      reason: string;
    }
  | {
      type: "candle_pattern";
      label:
        | "hammer"
        | "inverse_hammer"
        | "bullish_engulfing"
        | "tweezer_bottom"
        | "morning_star"
        | "doji";
      candleTimes: string[];
      reason: string;
    };

type VisualTrace = {
  id: string;
  agentId: string;
  tradeIdeaId?: string;
  marketId: string;
  strategyId: string;
  timeframe: Timeframe;
  status: VisualTraceStatus;
  title: string;
  annotations: VisualAnnotation[];
  currentStep:
    | "scanning_structure"
    | "drawing_fibonacci"
    | "drawing_trendline"
    | "watching_entry_zone"
    | "checking_news"
    | "waiting_for_confirmation"
    | "planning_trade"
    | "entered_trade"
    | "monitoring_trade"
    | "closed_trade";
  explanation: string;
  createdAt: string;
  updatedAt: string;
};
```

### Agent Work Replay

Every visual trace update should also be linked to a trade event. That makes the agent's work replayable:

1. Agent scans structure.
2. UI shows swing points.
3. Agent draws fibs or trendline.
4. UI shows levels and projected zones.
5. Agent checks news.
6. UI shows confluence label.
7. Agent waits for confirmation.
8. UI marks the confirmation candle.
9. Agent enters.
10. UI draws entry, SL, and TP.
11. Agent monitors.
12. UI updates mark price and PnL.

This is how users can inspect not only the final trade but the thinking process that produced it.

## Backend Responsibilities

The backend is the source of truth for trade state.

It should handle:

- Strategy registration from read-only strategy markdown sources.
- Market registry.
- Candle/price ingestion.
- News confluence snapshots.
- Agent scans.
- Watchlist records.
- Trade plans.
- Simulated entries.
- Position marking.
- PnL calculation.
- Monitoring schedules.
- Trade event logs.
- Visual trace records and chart annotations.
- Leaderboard and stats aggregation.
- Convex score commitments.

## Core Data Models

### Strategy

```ts
type Strategy = {
  id: string;
  name: string;
  sourcePath: "strategies/fibs-trend.md" | "strategies/third-touch.md";
  directionBias: "long_only";
  minRiskReward: 3;
  enabled: boolean;
  createdAt: string;
};
```

### Agent

```ts
type Agent = {
  id: string;
  name: string;
  strategyId: string;
  description: string;
  preferredMarkets: string[];
  preferredTimeframes: Timeframe[];
  riskLevel: "low" | "medium" | "high";
  status: "active" | "paused" | "retired";
  createdAt: string;
};
```

### Market

```ts
type Market = {
  id: string;
  symbol: string;
  name: string;
  category: "metal" | "energy" | "forex" | "rwa-vault";
  quoteCurrency: "USD" | "points";
  priceSource: "mock" | "pyth" | "broker" | "manual";
  priceFeedId?: string;
  enabled: boolean;
};
```

### News Snapshot

```ts
type NewsSnapshot = {
  id: string;
  marketId: string;
  headline: string;
  source: string;
  publishedAt: string;
  summary: string;
  confluence: NewsConfluence;
  impact: "low" | "medium" | "high";
  createdAt: string;
};
```

### Trade Idea

```ts
type TradeIdea = {
  id: string;
  agentId: string;
  strategyId: string;
  marketId: string;
  status: TradeIdeaStatus;
  side: "long";
  setupTimeframe: Timeframe;
  executionTimeframe: Timeframe;
  watchReason: string;
  technicalThesis: string;
  newsSnapshotId?: string;
  newsConfluence: NewsConfluence;
  expectedEntryZone?: {
    low: number;
    high: number;
  };
  invalidationReason?: string;
  createdAt: string;
  updatedAt: string;
};
```

### Trade Plan

```ts
type TradePlan = {
  id: string;
  tradeIdeaId: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  positionSizePoints: number;
  confirmationPattern: string;
  confidence: number;
  thesis: string;
  createdAt: string;
};
```

### Position

```ts
type Position = {
  id: string;
  tradeIdeaId: string;
  agentId: string;
  marketId: string;
  status: "open" | "closed";
  side: "long";
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  markPrice: number;
  unrealizedPnlPoints: number;
  unrealizedPnlPercent: number;
  realizedPnlPoints: number;
  openedAt: string;
  closedAt?: string;
  closeReason?: "take_profit_hit" | "stop_loss_hit" | "manual" | "invalidated";
  updatedAt: string;
};
```

### Trade Event

```ts
type TradeEvent = {
  id: string;
  tradeIdeaId: string;
  agentId: string;
  type:
    | "scan"
    | "visual_trace_updated"
    | "watchlisted"
    | "news_checked"
    | "ready_to_enter"
    | "entered"
    | "monitoring_check"
    | "take_profit_hit"
    | "stop_loss_hit"
    | "invalidated"
    | "expired";
  message: string;
  payload: Record<string, unknown>;
  createdAt: string;
};
```

### Score Commitment

```ts
type ScoreCommitment = {
  id: string;
  seasonId: string;
  agentId: string;
  statsHash: string;
  leaderboardHash: string;
  source: "convex";
  committedAt: string;
};
```

Score commitments stay in Convex for now. A commitment is a hash of the leaderboard/stats snapshot at a point in time. It is useful for internal auditability without adding blockchain complexity before the product loop works.

### Agent Stats

```ts
type AgentStats = {
  agentId: string;
  seasonId: string;
  totalTradeIdeas: number;
  enteredTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  netPnlPoints: number;
  netReturnPercent: number;
  averageRiskReward: number;
  maxDrawdownPercent: number;
  profitFactor: number;
  openPositions: number;
  watchlistedSetups: number;
  updatedAt: string;
};
```

## Leaderboard

The leaderboard should rank strategy agents by discipline and performance, not raw PnL alone.

Suggested score:

```text
score =
  net_return_points
  + 0.35 * risk_adjusted_return
  + 0.20 * consistency_score
  + 0.15 * setup_quality_score
  - 0.50 * max_drawdown_penalty
  - 0.25 * invalid_trade_penalty
```

Metrics:

- Net PnL in points.
- Net return percent.
- Win rate.
- Profit factor.
- Max drawdown.
- Average risk/reward.
- Number of watchlisted setups.
- Number of entered trades.
- Setup-to-entry conversion rate.
- Number of invalidated setups.
- Average time in trade.
- News confluence quality.

Leaderboard views:

- Overall.
- Fibonacci Trend Continuation.
- Third Touch Trendline.
- Gold/XAU specialists.
- Forex specialists.
- Best risk-adjusted agents.
- Most disciplined agents.

## Agent Decision Loop

MVP loop:

1. Load enabled markets.
2. Load latest candles for configured timeframes.
3. Load relevant news snapshots.
4. Run strategy detector.
5. If market is interesting but not ready, create or update watchlist record.
6. If setup reaches entry conditions, classify news confluence.
7. Validate technical rules.
8. Validate risk/reward.
9. Mark trade as entered if rules pass.
10. Schedule monitoring checks based on execution timeframe.
11. Update PnL and stats on each check.
12. Write every meaningful action to `TradeEvent`.
13. Write every chart action to `VisualTrace`.

## Guardrails

- No real-money trading in MVP.
- No automatic broker execution.
- No self-modifying strategies.
- No entry without stop loss.
- No entry without take profit.
- No entry below 1:3 risk/reward.
- No entry during high-impact event risk unless explicitly allowed later.
- No hidden decisions; every action must have an event log.
- No hidden drawings; every strategy line, level, and marker must exist as structured visual trace data.
- No strategy source edits from the agent runtime.

## UI Plan

### Arena Dashboard

Primary panels:

- Live agent leaderboard.
- Markets being scanned.
- Watchlisted setups.
- Open simulated trades.
- Recent trade events.
- News confluence feed.
- Active agent workspace showing current chart annotations.

### Agent Detail

Primary panels:

- Strategy source name.
- Current watchlist.
- Open positions.
- Closed trades.
- Equity curve.
- Win rate, profit factor, max drawdown, and net return.
- Decision/event timeline.
- Visual workspace showing what the agent is currently drawing or watching.

### Trade Detail

Primary panels:

- Market and timeframe.
- Strategy used.
- Technical thesis.
- News confluence.
- Entry, stop loss, take profit.
- Current mark price.
- Percent in profit/loss.
- Distance to SL and TP.
- Monitoring history.
- Visual replay of the setup and trade.
- Final outcome.

### Market Detail

Primary panels:

- Price chart.
- Relevant news.
- Agents watching this market.
- Active trade ideas.
- Historical agent performance on this market.
- Agent overlays for watched setups and active trades.

## Implementation Phases

### Phase 0: Research Lock

- Create this document.
- Treat `strategies/*.md` as read-only strategy source.
- Decide initial markets.
- Decide backend persistence layer.

### Phase 1: Backend Data Model

- Add strategy, agent, market, trade idea, trade plan, position, trade event, and stats models.
- Seed the two strategies from file paths, not edited file contents.
- Seed initial agents: one Fibonacci agent and one Third Touch agent.

### Phase 2: Mock Market Data

- Add mock OHLCV candles.
- Add mock price updates.
- Add mock news snapshots.
- Prove the lifecycle from scan to watchlist to entered to monitored to closed.

### Phase 3: Strategy Detectors

- Implement Fibonacci trend continuation detector.
- Implement third-touch trendline detector.
- Keep both deterministic enough to test.
- Require explicit technical thesis output.

### Phase 4: Monitoring Engine

- Add timeframe-aware scheduled checks.
- Update mark price and PnL.
- Detect stop loss and take profit.
- Write monitoring events.
- Aggregate stats.

### Phase 5: Visual Trace Engine

- Add `VisualTrace` and `VisualAnnotation` records.
- Emit fib drawings, trendlines, entry zones, confirmation patterns, SL, TP, and mark-price levels from strategy detectors.
- Link visual trace updates to trade events.
- Add replay support for agent work history.

### Phase 6: UI

- Build Arena Dashboard.
- Build Agent Detail.
- Build Trade Detail.
- Build Market Detail.
- Show leaderboard and live trade-state transitions.
- Render candlestick charts with agent overlays.
- Show an active agent workspace for scan, watchlist, entry, and monitoring states.

### Phase 7: Real Data Integrations

- Add real market price adapter.
- Add news API adapter.
- Add stale-data and missing-data handling.
- Keep mock fallback for development.

### Phase 8: Future Live Trading Execution

Live trading should come after the simulated strategy engine is stable and statistically useful.

Possible execution directions later:

- Build a dedicated perp venue.
- Integrate with a Solana perp venue such as Percolator, Perpolator, or a terminal built on similar infrastructure.
- Integrate with another broker/perp API if it better supports the first markets.

Before live trading, require:

- Strategy backtests.
- Paper-trading performance.
- Position sizing controls.
- User opt-in.
- Venue due diligence.
- Oracle/risk/liquidation review.
- Kill switch.
- Clear legal and risk disclaimers.

## Open Questions

- Which initial markets should agents scan first: XAU/USD, XAG/USD, EUR/USD, GBP/USD, oil, or crypto pairs?
- Should each strategy get one agent, or should multiple agents run the same strategy on different timeframes?
- Should high-impact news block all entries by default, or only entries in the affected market?
- Should position sizing be fixed points per trade or percent risk based on stop-loss distance?
- Should the first backend live in Convex or a plain local simulation service?
- Should the product copy frame this as commodities-only, forex-plus-commodities, or price-action strategy arena?
- Should the first chart renderer use TradingView Lightweight Charts plus SVG overlays, or a fully custom canvas?
- Which Solana perp venue is realistic later: Percolator, Perpolator, Drip, Drift, or a custom Gildore venue?

## MVP Definition Of Done

The MVP is ready when:

- The two strategy files remain unchanged.
- Two agents exist, one per strategy.
- Agents scan at least one market.
- Agents can create watchlist entries.
- Agents can mark trades as entered with entry, SL, TP, timeframe, and thesis.
- Open trades show percent PnL and current status.
- 15m trades check every 30 minutes, and other timeframes follow the two-candle rule.
- Closed trades update agent stats.
- Leaderboard ranks the two agents by performance and discipline.
- Every decision is visible through a trade event timeline.
- Every fib, trendline, entry zone, SL, TP, and confirmation marker is visible through a chart workspace.
- Score commitments are stored in Convex.
