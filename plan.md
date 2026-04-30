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

---

What is already done:

- landing page
- /arena route
- typed domain model
- mock agents / watchlists / events / traces
- real chart workspace
- Pyth-backed candles with polling
- replay timeline
- chart-space annotations
- layer toggles

What is still missing, in priority order:

1. Real strategy engine
   - right now traces and decisions are still mock-authored
   - we need code that reads candle data and produces:
     - watchlist candidates
     - entry-ready states
     - entered trades
     - SL / TP
     - trace annotations
2. Backend persistence
   - current arena state is in local mock files
   - move to Convex tables for:
     - agents
     - markets
     - watchlists
     - trade ideas
     - positions
     - trade events
     - visual traces
     - leaderboard snapshots
3. Market selection / scanning workflow
   - agents should scan a defined market universe
   - not just render one selected symbol
   - we need the scanning loop:
     - fetch markets
     - inspect structure
     - store candidate setups
     - promote to watchlist
     - promote to entry
4. News confluence integration
   - still mocked
   - need a real news source and a confluence classifier:
     - supportive
     - neutral
     - risk
5. Trade lifecycle engine
   - state machine exists conceptually, but not in code
   - implement:
     - idle
     - scanning
     - watchlist
     - ready
     - entered
     - monitoring
     - closed
6. Leaderboard from actual results
   - currently static scores
   - should derive from simulated closed/open trade performance
7. Timeframe-driven monitoring
   - example:
     - 15m trade checks every 30m
   - this needs scheduled logic, not just UI text

So the real answer is:

the biggest missing piece is the first strategy engine.

That is the point where Gildore Arena stops being a polished shell and starts becoming the product.

Best next implementation order:

1. encode one strategy detector first
2. turn its output into WatchlistItem, TradeIdea, TradeEvent, VisualTrace
3. then persist that flow in Convex
4. then add the second strategy

My recommendation:

- start with the Fibonacci strategy first
- it is more bounded visually and easier to express in annotations than the third-touch one

So the next concrete step should be:

1. define the first strategy engine contract
2. implement Fibonacci detection against current candle data
3. emit arena state from it

---

1. Kill the 8h pan-to-oldest-history (View 2 redesign)

Instead of panning back to ancient data, View 2 should be the 8h chart showing the current structural cycle clearly: the Jan-Feb 2026 bottom (the  
 massive selloff from the Nov 2025 peak), and then the entire rally from that bottom to now. That's what you did manually — you didn't need to go to
2024 data.

2. Reframe the prompt: T1 = origin of the current visible trend, not historical max

The key phrase change: instead of "absolute deepest trough in full history" → "the trough that launched the current multi-week or multi-month trend
visible in the 4h trading timeframe." Add explicitly: "If the 8h view shows ancient lows from a completely different cycle — ignore them. T1 must be
a point you can draw a line FROM and reach the current price action."

The slope sanity check we added already catches the "too-old T1" case, but the prompt should head it off before the agent even tries.  

