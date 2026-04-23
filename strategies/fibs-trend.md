# Fibonacci Trend Continuation Strategy

## 1. Objective

This skill equips the trading agent to identify, validate, and execute "Trend Continuation" trades in an established uptrend. The agent will utilize Fibonacci retracements to locate high-probability pullback zones and execute long (buy) positions confirmed by specific bullish candlestick patterns and multi-timeframe confluence.

---

## 2. Foundational Knowledge: Price Action & OHLCV

Before executing, the agent must parse market data using the **OHLCV** model for each given timeframe.

- **O (Open):** The price at which the asset began trading during the specific period.
- **H (High):** The highest price reached during the period.
- **L (Low):** The lowest price reached during the period.
- **C (Close):** The final price at the end of the period. _The Close is the most critical metric for confirming pattern formations and level invalidations._
- **V (Volume):** The total amount of the asset traded. (Used as secondary confirmation for institutional participation during reversals).

---

## 3. Core Strategy Mechanics

### A. Trend Identification & The "Swing"

- **Uptrend:** A sequence of Higher Highs (HH) and Higher Lows (HL).
- **Swing Low:** A distinct trough in price action where the price stopped falling and began to rise.
- **Swing High:** A distinct peak in price action where the price stopped rising and began to fall.

### B. The Fibonacci Retracement Tool

The agent will draw the Fibonacci tool strictly from the **Bottom of the Swing (Swing Low)** to the **Top of the Swing (Swing High)** of the most recent impulsive bullish wave.

- **Primary Reversal Zones:** The agent will monitor the `0.5`, `0.618`, and `0.7` levels.
- **Dynamic Level Validation:** The agent must backtest the current trend's historical behavior. If the previous 2-3 impulsive waves in the current trend retraced perfectly to the `0.5` level before continuing upward, the agent will weight the `0.5` level with the highest probability for the upcoming trade.

---

## 4. Execution Protocol

### Step 1: Historical Validation (The Rule of Consistency)

Analyze the chart's recent history. Measure previous swings using Fibonacci. Identify which level the market is currently respecting (e.g., consistent bounces off the 0.5 level). Base the current bias on this established rhythm.

### Step 2: Identify the Entry Zone

Wait for the current impulsive wave to top out (forming a Swing High) and begin its retracement. Alert when price enters the determined High Probability Zone (e.g., between the 0.5 and 0.618 levels).

### Step 3: Multi-Timeframe (MTF) Confluence

Once price enters the Fibonacci zone on the macro timeframe (e.g., 4H or 1H), the agent must switch to a micro timeframe (e.g., 15m or 5m) to observe price behavior. The agent is looking for a loss of bearish momentum (smaller bearish candles, consolidation) aligning with the macro Fibonacci level.

### Step 4: Candlestick Confirmation (The Trigger)

The agent is strictly prohibited from entering a blind limit order at the Fibonacci level. It must wait for a **Close** of one or more of the following bullish reversal/continuation patterns strictly within the validated Fibonacci zone:

- **Hammer:** Small body near the high, long lower wick (showing rejection of lower prices).
- **Inverse Hammer:** Small body near the low, long upper wick (often preceding a bullish burst after a downtrend).
- **Bullish Engulfing:** A bullish candle whose body completely engulfs the body of the preceding bearish candle.
- **Tweezer Bottom:** Two consecutive candles with matching or nearly matching lows, indicating strong support.
- **Morning Star:** A three-candle pattern: a long bearish candle, a small-bodied candle (indecision), and a long bullish candle.
- **Doji:** A candle where the Open and Close are virtually identical, indicating exhaustion of the bearish push.
  > **Note:** Confluence increases probability. If multiple patterns form in cluster (e.g., a Doji followed by a Bullish Engulfing) exactly at the 0.5 level, the signal strength is upgraded to maximum.

### Step 5: Trade Execution & Risk Management

Upon candlestick confirmation, execute a **Long (Buy)** position.

- **Stop Loss (Invalidation):** Placed strictly below the most recent Swing Low (the origin of the Fibonacci draw) or just below the wick of the confirmation candlestick pattern. A candle _closing_ below this level invalidates the trend continuation hypothesis.
- **Take Profit (Target):** Calculate target based on a strict Risk-to-Reward (RR) ratio. The baseline minimum strategy requirement is **1:3 RR** (risking 1 unit to make 3 units). The primary target should align with creating a new Higher High beyond the previous Swing High.
