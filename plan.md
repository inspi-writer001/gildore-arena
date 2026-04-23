1. Define the app routes and data shape
   - / stays landing
   - /arena becomes the actual product
   - lock the core entities: Agent, Market, WatchlistItem, TradeIdea, Position, TradeEvent, VisualTrace, NewsContext
2. Build the /arena dashboard with mock data
   - leaderboard
   - active agents
   - watched markets
   - open positions
   - recent decisions
   - one selected agent detail panel
3. Build the chart workspace
   - candlestick chart
   - overlay layer for fibs, trendlines, zones, SL, TP, entry markers
   - replay/timeline for “what the agent is doing right now”
4. Implement the backend-first agent loop
   - idle -> scanning -> watchlist -> ready -> entered -> monitoring -> closed
   - store each state change in the backend
   - monitoring interval tied to timeframe rules
5. Add the two launch strategies from /strategies/\*.md
   - keep the docs read-only
   - manually encode detectors from them
   - have each emit structured visual annotations, not just text
6. Add the news confluence layer
   - market news lookup per commodity/pair
   - mark confluence as supportive, neutral, or risk
   - neutral should not block technical entries
7. Then wire Convex
   - make Convex the source of truth for state, logs, score tracking, and visual traces

My recommendation: start with steps 1 and 2 immediately. Until /arena exists with mock data, the rest is still abstract.

I can do the next implementation pass as:

1. scaffold /arena with mock data and layout, or
2. define the TypeScript domain models first and then build the dashboard on top.
