# Third Touch Trendline Strategy (Long/Bullish Bias)

## 1. Foundational Data Structure: OHLCV

Before executing structural analysis, the agent must parse raw market data into candlestick primitives. Every time period (e.g., 4-Hour, 1-Hour, 15-Minute) is represented by an OHLCV vector:

- **O (Open):** The initial price at the start of the timeframe.
- **H (High):** The absolute highest price reached during the timeframe (forms the upper wick/shadow).
- **L (Low):** The absolute lowest price reached during the timeframe (forms the lower wick/shadow).
- **C (Close):** The final price at the end of the timeframe. The distance between Open and Close forms the "Body".
- **V (Volume):** The total number of assets traded during the timeframe.

_Agent Logic:_ The relationship between the Close and the Trendline is the primary decider for validation vs. invalidation.

---

## 2. Market Phase Identification (The Uptrend)

The strategy is strictly trend-following. The agent must first confirm a bullish market structure before attempting to draw trendlines.

- **Condition:** The market must be printing a sequence of Higher Highs (HH) and Higher Lows (HL).
- **Action:** Scan the target timeframe (e.g., 4H) for distinct fractal swing lows to use as anchor points.

---

## 3. Trendline Construction & The "Third Touch" Setup

The core geometric logic relies on projecting a ray from two validated swing lows to anticipate a third.

- **Touch 1 (Anchor):** Identify the lowest recent swing low that initiated the current upward momentum.
- **Touch 2 (Confirmation):** Identify the next immediate swing low (must be higher than Touch 1).
- **Projection:** Draw a straight line connecting the `Low` (or lower body) of Touch 1 and Touch 2. Project this line infinitely to the right.
- **The Target (Touch 3):** The strategy dictates that the third time price returns to this projected line, it will trigger a rapid, high-momentum move to the upside. The agent must set alerts for when current price approaches this projection.

---

## 4. Touch Validation vs. Invalidation Rules

The agent must precisely analyze the interaction between the candlestick and the trendline at Touch 3 to determine viability.

### Valid Touches (Proceed to Entry Protocol)

1.  **Perfect Touch:** The Low (wick) touches the trendline precisely, and the Close is above the trendline.
2.  **Wick Penetration (Fake-out):** The Low pierces below the trendline, but the candle Body (the Close) is rejected and closes _above_ or exactly _on_ the trendline.
3.  **Proximity Touch:** The Low comes extremely close to the trendline (within a predefined tight margin of error) without piercing it.

### Invalidation (Abort Setup)

- **Total Close Below:** If a candlestick (or multiple consecutive candlesticks) closes its _body_ aggressively below the trendline.
- **Agent Action:** If a strong bearish candle body closes fully beneath the line, the structure is broken. Cancel all pending entry protocols for this specific trendline.

---

## 5. Entry Triggers & Candlestick Confirmation

The agent must **never** enter a trade blindly just because the price touched the line. It must wait for bullish reversal or continuation candlestick patterns to print at the exact region of the third touch.

### Primary Candlestick Triggers

The agent must parse the OHLC data at the trendline for the following formations:

- **Hammer:** Small body near the high, long lower wick (at least twice the body length), little to no upper wick. Indicates severe rejection of lower prices.
- **Inverse Hammer:** Small body near the low, long upper wick. In a downtrend approaching a support line, this indicates buyers are stepping in.
- **Bullish Engulfing:** A bearish candle followed immediately by a larger bullish candle whose body completely overlaps (engulfs) the previous bear body.
- **Tweezer Bottom:** Two consecutive candles (often one bearish, one bullish) that share the exact same Low price, rejecting the trendline simultaneously.
- **Morning Star:** A three-candle formation: A large bearish candle, a small-bodied middle candle (indecision), and a large bullish candle that closes well into the body of the first.
- **Doji:** Open and Close are virtually identical, showing market equilibrium. Highly actionable when resting exactly on the trendline, especially if followed by a bullish expansion.

### Confluence & Multi-Timeframe (MTF) Alignment

- **Cluster Rule:** The presence of _multiple_ trigger candles at the trendline (e.g., a Doji followed by a Bullish Engulfing) exponentially increases the trade probability.
- **MTF Zoom-In:** If the trendline is drawn on a Macro timeframe (e.g., 4H), the agent must drop to Micro timeframes (e.g., 1H, 15m) as price approaches the line.
- _Action:_ Use the Micro timeframe to spot the exact candlestick triggers (Hammer, Engulfing) forming against the Macro trendline to secure an earlier, tighter entry.

---

## 6. Risk Management & Execution Parameters

Trade logic must be executed with strict predefined spatial constraints.

- **Entry (`Buy_Limit` or `Market_Execution`):** Executed upon the close of the confirming trigger candlestick(s) at Touch 3.
- **Stop Loss (SL):** Placed below the _previous_ significant turning point (the swing low prior to the Touch 3 zone) to allow for breathing space against market noise. Do not place the SL tightly under the entry candle.
- **Take Profit (TP):** The algorithm must automatically calculate the distance between Entry and SL, and multiply it by 3.
- **Risk/Reward Requirement:** `(Take Profit - Entry) >= 3 * (Entry - Stop Loss)`. If the market structure does not allow for a clear 1:3 R/R before hitting major overhead resistance, the agent should invalidate the trade.
