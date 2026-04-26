# Third Touch Trendline Strategy

## 1. Foundational Data Structure: OHLCV

The agent reasons from candlesticks, not raw ticks. Every period is parsed into:

- **O (Open):** price at the start of the candle
- **H (High):** highest traded price in the candle
- **L (Low):** lowest traded price in the candle
- **C (Close):** final traded price in the candle
- **V (Volume):** traded size during the candle

Agent rule:

- **Body location matters more than wick location for invalidation.**
- Wicks can fake out. Candle bodies decide whether the line is still structurally valid.

---

## 2. Timeframe and Context Requirements

The strategy must not reason over a tiny local patch of candles. The line has to come from visible structure.

### Current arena defaults

- **1H third-touch agent**
  - fetches roughly **240 hourly candles**
  - reasons primarily over the latest **168 candles** (about **7 days**)

This is the minimum working context for the current engine. The point is:

- **do not build a third-touch line from only 2-3 days of local noise**

---

## 3. Market Regime Detection Comes First

The strategy is **regime-gated** before any trendline is drawn.

The agent must first classify the recent structure as:

- **bullish**
- **bearish**
- **mixed**

### Bullish regime

Use only when recent structure shows:

- higher lows and supportive close drift
- bullish continuation behavior

Then the engine is allowed to search for:

- **ascending support**
- **long third-touch setups**

### Bearish regime

Use only when recent structure shows:

- lower highs and negative close drift
- bearish continuation behavior

Then the engine is allowed to search for:

- **descending resistance**
- **short third-touch setups**

### Mixed regime

If recent structure is conflicted or range-bound:

- **do not force a line**
- return no setup

Hard rule:

- **never draw a rising support line in a clearly falling market**
- **never draw a falling resistance line in a clearly rising market**

---

## 4. Swing Identification Rules

The swing logic must prefer structural turning points, not tiny local bumps.

### Current reinforced rule

A swing high or swing low should be significant relative to a wider neighborhood.

For the current engine implementation:

- a swing uses a **10-candle radius**
- that means the pivot is judged against **10 candles to the left and 10 candles to the right**

Interpretation:

- a valid swing high should stand above a broad surrounding cluster
- a valid swing low should stand below a broad surrounding cluster

This is intentionally stricter than the earlier local-fractal approach.

Practical takeaway:

- the engine should anchor to **major visible structure**
- not micro zig-zags

---

## 5. Trendline Construction

After regime detection and swing extraction, the engine builds candidate lines.

### Bullish path

- **Touch 1 (`T1`)** = first major swing low
- **Touch 2 (`T2`)** = later higher swing low
- connect `T1 -> T2`
- project forward as **ascending support**

### Bearish path

- **Touch 1 (`T1`)** = first major swing high
- **Touch 2 (`T2`)** = later lower swing high
- connect `T1 -> T2`
- project forward as **descending resistance**

### Pair selection rule

Do not simply take the first pair that fits.

The engine should prefer the line that best represents:

- the dominant visible structure
- reasonable span across the chart
- continued market respect after `T2`
- projection that still lands near current price, not far away from the active market

---

## 6. The Third-Touch Zone

The third touch is not a single pixel. It is a **zone around the projected line**.

The agent must create a tolerance band around the projected line using:

- recent average candle range
- a small price-relative margin

This produces a **third-touch zone**, not just a naked line.

That zone is what the replay should visualize during the second step.

---

## 7. Valid Touch vs. Invalidation

### Valid touch

The setup remains valid when price interacts with the projected line and:

- respects the line closely
- rejects from it
- or only performs a wick fake-out while the body remains on the valid side

### Invalidation

The setup is invalidated when the projected line is passed through by candle body structure, not just wick noise.

Examples:

- **bullish/support setup invalidation**
  - candle body closes materially below the projected support line

- **bearish/resistance setup invalidation**
  - candle body closes materially above the projected resistance line

This is not just a warning. It changes the line.

---

## 8. T2 Rollover Rule After Invalidation

This is the most important reinforced rule from the latest engine work.

If the projected line is invalidated after the old `T2`, the engine must:

1. detect the **first invalidating candle body**
2. promote that candle body into the **new `T2`**
3. redraw the line from the original `T1` to the **new `T2`**
4. project the next third-touch zone from that new line

### Body selection rule

- for **bearish resistance**, the relevant body anchor is the **top of the body**
  - `max(open, close)`

- for **bullish support**, the relevant body anchor is the **bottom of the body**
  - `min(open, close)`

This prevents the engine from holding onto a broken old line after structure has already migrated.

Hard rule:

- use the **first** qualifying invalidation body after the old `T2`
- do **not** skip forward and keep promoting later invalidations unless the strategy explicitly says to do so

---

## 9. Third-Touch Candidate Selection

After the valid line is established, the engine searches for the best later candle cluster that behaves like the next touch.

It should score candidates by:

- proximity to the projected line
- how cleanly the candle reacts from that level
- whether the body remains on the correct side
- whether the move is still structurally aligned with regime

The chosen candidate should be:

- the most defensible interaction with the projected line
- not simply the latest candle in the window

---

## 10. Candlestick Confirmation

A touch alone is not enough.

### Bullish confirmation patterns

- hammer
- bullish engulfing
- doji at support
- tweezer bottom

### Bearish confirmation patterns

- shooting star
- bearish engulfing
- doji at resistance
- tweezer top

If there is no confirmation:

- keep the setup in **watchlist** or **ready**
- do not enter blindly

---

## 11. State Model

The third-touch agent should move through:

- `scanning`
- `watchlist`
- `ready`
- `entered`
- `monitoring`
- `closed`

### Practical interpretation

- **watchlist:** line is valid, structure exists, still waiting
- **ready:** price is in the touch zone or trigger is close, but not fully entered
- **entered:** confirmation and execution conditions are met

Special cases:

- if reward is capped before 1:3, hold in staged mode
- if headline risk is elevated, hold in staged mode even if technicals are otherwise valid

---

## 12. Risk Management

### Entry

Entry should come from:

- confirmed reaction at the third-touch zone
- not from blind line contact

### Stop loss

Stop should sit beyond the relevant structural turning point, not too tight to noise.

For bearish setups:

- above the relevant invalidation structure / resistance anchor

For bullish setups:

- below the relevant invalidation structure / support anchor

### Take profit

The baseline requirement remains:

- **minimum 1:3 risk/reward**

If the projected path cannot achieve 1:3 before obvious opposing structure:

- do not enter
- keep it staged or reject it

---

## 13. Replay and Visualization Contract

The chart should communicate structure honestly.

### Step 1

Show:

- `T1`
- `T2`
- projected line

### Step 2

Show:

- the active **third-touch zone**
- while still keeping `T1` and `T2` visually relatable

### Step 3

If the setup is **not entered**:

- keep the step **area-first**
- do not invent active entry/SL/TP markers as if a trade already triggered

If the setup **is entered**:

- then show entry, stop, and target

---

## 14. Summary

The updated third-touch strategy is:

1. use a wide enough market context
2. detect regime first
3. only search for lines that match the regime
4. use broad structural swings, not tiny pivots
5. build the dominant line
6. treat the touch as a zone, not a pixel
7. use body-based invalidation
8. when invalidated, promote the first invalidating body into the new `T2`
9. redraw and re-project from there
10. only enter after confirmation and minimum 1:3 reward path
