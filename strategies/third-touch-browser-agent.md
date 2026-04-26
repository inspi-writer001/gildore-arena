# Third-Touch Browser Agent Contract

## Goal

Use a **hybrid flow** for the third-touch strategy:

1. deterministic code generates a small set of candidate structures
2. a browser agent inspects those candidates visually
3. the browser agent returns a strict structured decision

The browser agent is **not** responsible for scanning the whole market from zero.
It is responsible for **judging chart structure better than the hard-coded engine**.

---

## Why Hybrid Instead of Fully Visual-First

The deterministic pre-filter should handle:

- market/timeframe scheduling
- candle fetching
- broad regime classification
- initial swing extraction
- candidate trendline generation
- obvious invalidation rejection
- basic 1:3 reward-path screening

The browser agent should handle:

- visual structure judgment
- choosing the dominant visible line
- correcting `T1` / `T2`
- judging whether the projected `T3` region is visually clean
- deciding whether the candidate is:
  - valid
  - staged
  - invalid

This keeps the browser agent focused on the hardest part:

- **human-like visual chart interpretation**

instead of wasting cost on broad market scanning.

---

## Stage 1: Deterministic Pre-Filter

The pre-filter runs first and produces candidate packets.

### Inputs

- `marketSymbol`
- `timeframe`
- fetched OHLCV candle set
- strategy config

### Current default context

For the active `1h` third-touch agent:

- fetch about `240` candles
- reason over latest `168` candles
- swing radius currently `10`

### Deterministic responsibilities

The pre-filter must:

1. classify regime:
   - `bullish`
   - `bearish`
   - `mixed`

2. generate only regime-aligned candidates:
   - bullish -> ascending support only
   - bearish -> descending resistance only
   - mixed -> no candidate

3. extract broad structural swing points

4. build one or more candidate lines:
   - `T1`
   - `T2`
   - projected line

5. detect invalidation rollover:
   - if old line is invalidated by candle body after `T2`
   - first invalidating candle body becomes new `T2`

6. produce a projected `T3` zone

7. reject obviously bad candidates:
   - line too far from current price
   - invalid structure
   - impossible reward path

### Deterministic output

The pre-filter should return a short list of candidate packets.

Prefer:

- `0-3` candidates per market/timeframe
- ideally `1` best candidate plus alternates only when close in score

---

## Candidate Packet Schema

```ts
type ThirdTouchCandidatePacket = {
  marketSymbol: string;
  timeframe: "15m" | "1h" | "4h";
  regime: "bullish" | "bearish" | "mixed";
  direction: "long" | "short";
  contextWindow: {
    fetchedCandles: number;
    activeCandles: number;
    swingRadius: number;
  };
  anchors: {
    t1: {
      barIndex: number;
      timeSec: number;
      price: number;
    };
    t2: {
      barIndex: number;
      timeSec: number;
      price: number;
    };
  };
  projection: {
    candidateBarIndex: number;
    candidateTimeSec: number;
    projectedLinePrice: number;
    zoneLow: number;
    zoneHigh: number;
  };
  invalidation: {
    rolledT2: boolean;
    priorT2?: {
      barIndex: number;
      timeSec: number;
      price: number;
    };
    invalidationCandle?: {
      barIndex: number;
      timeSec: number;
      bodyAnchorPrice: number;
    };
  };
  riskModel: {
    proposedEntry: number;
    proposedStopLoss: number;
    proposedTakeProfit: number;
    hasMinimumRR: boolean;
  };
  deterministicReason: string;
};
```

---

## Stage 2: Browser Agent Responsibilities

The browser agent receives:

- the candidate packet
- the strategy doctrine from `strategies/third-touch.md`
- the chart URL / browser session

It should inspect the chart visually and answer:

1. Is the detected regime visually correct?
2. Is `T1` structurally correct?
3. Is `T2` structurally correct?
4. Is the projected line the **dominant** line a human would choose?
5. Is the projected `T3` zone visually credible?
6. Is the setup:
   - valid
   - staged
   - invalid

The browser agent is allowed to disagree with the deterministic packet.

---

## Browser Agent Allowed Actions

The browser agent may:

- open the chart page
- change timeframe if needed
- pan
- zoom
- inspect candle bodies and wicks
- compare local and broader structure
- identify corrected anchors

The browser agent should **not**:

- roam across unrelated symbols by itself
- invent an entirely different strategy
- write directly to final production state without returning structured output first

---

## Browser Agent Output Schema

```ts
type ThirdTouchBrowserDecision = {
  marketSymbol: string;
  timeframe: "15m" | "1h" | "4h";
  verdict: "valid" | "staged" | "invalid" | "reject";
  regimeAssessment: "bullish" | "bearish" | "mixed";
  chosenDirection: "long" | "short" | "none";
  correctedAnchors: {
    t1?: {
      barIndex: number;
      timeSec?: number;
      price: number;
    };
    t2?: {
      barIndex: number;
      timeSec?: number;
      price: number;
    };
  };
  correctedProjection?: {
    projectedLinePrice: number;
    zoneLow: number;
    zoneHigh: number;
  };
  confidence: number;
  rationale: string;
  issues: string[];
  keepDeterministicCandidate: boolean;
};
```

---

## Merge Rule

The browser agent is **auto-correcting**, not advisory-only.

That means:

1. deterministic engine proposes candidate
2. browser agent evaluates candidate
3. browser agent corrections become the new persisted Arena structure

### Auto-correction rules

- if browser verdict is `reject` or `invalid`:
  - persist the rejection outcome
  - do not promote the candidate into active setup state

- if browser verdict is `staged`:
  - persist corrected anchors and corrected zone
  - keep setup in watchlist/ready state

- if browser verdict is `valid`:
  - persist corrected anchors
  - persist corrected zone
  - continue normal confirmation / execution logic from the corrected structure

Hard rule:

- once the browser review finishes, the corrected `T1`, `T2`, and `T3` zone become the chart state used by Arena replay
- the deterministic candidate is just the proposal layer

---

## First Prototype Scope

Do **not** start by making the browser agent fully autonomous.

Prototype only this:

1. deterministic engine produces **one** `XAG/USD 1h` candidate
2. browser agent opens the chart
3. browser agent returns:
   - regime
   - corrected `T1`
   - corrected `T2`
   - corrected `T3` zone
   - verdict

That is enough to validate whether the hybrid model is worth expanding.

---

## Open Design Questions

These still need explicit decisions before implementation:

1. Should the browser agent return:
   - exact bar indices
   - approximate visible chart coordinates
   - or both?

2. Should the browser agent be:
   - advisory only
   - or able to overwrite deterministic anchors automatically?

3. Should the deterministic pre-filter emit:
   - one best candidate
   - or top three candidates?

4. Should the browser step run:
   - only when deterministic confidence is ambiguous
   - or on every candidate?

---

## Step 2 Decision: Use Both Charts

For the first browser-agent prototype, use:

- **Deriv chart** as the primary visual inspection surface
- **Arena chart** as the application output surface

Reason:

- Deriv gives the agent a mature charting UI for visual reading
- Arena remains the source of truth for persisted strategy state
- this lets the agent inspect structure on a chart optimized for reading, while still writing corrections back into our own system

---

## Browser-Agent Execution Flow

### Inputs into the browser-agent run

The run starts with:

- one deterministic `ThirdTouchCandidatePacket`
- strategy doctrine from:
  - `strategies/third-touch.md`
  - `strategies/third-touch-browser-agent.md`
- target chart symbol and timeframe

### Sequence

1. **Load Arena candidate context**
   - read candidate packet
   - read current persisted annotations and replay state
   - note deterministic:
     - regime
     - direction
     - `T1`
     - `T2`
     - projected `T3` zone

2. **Open Deriv chart**
   - load `https://charts.deriv.com/deriv`
   - switch to the same:
     - symbol
     - timeframe
   - zoom and pan until the same broad structural window is visible

3. **Visually verify the deterministic candidate**
   - inspect whether the trend regime is actually:
     - bullish
     - bearish
     - mixed
   - inspect whether the deterministic `T1` and `T2` are the dominant visible anchors
   - inspect whether:
     - the old line was invalidated
     - the replacement `T2` is correct
     - the projected `T3` zone is visually credible

4. **Return structured corrections**
   - do not write directly from the browser session
   - return:
     - regime assessment
     - chosen direction
     - corrected `T1`
     - corrected `T2`
     - corrected `T3` zone
     - verdict
     - rationale

5. **Persist back into Arena**
   - Arena consumes the browser output
   - Arena updates the persisted trace and state
   - Arena replay then renders the corrected line and zone

---

## Role Split Between Deriv and Arena

### Deriv is for:

- visual reading
- zoom/pan inspection
- human-like structure judgment
- choosing whether the deterministic candidate is visually valid

### Arena is for:

- deterministic scan scheduling
- candidate generation
- persistence
- replay
- event logs
- final agent state

The browser agent should treat Deriv as the **inspection tool**, not the system of record.

---

## First Prototype Behavior

For the first implementation pass, keep the browser-agent narrow:

- one market:
  - `XAG/USD`
- one timeframe:
  - `1h`
- one deterministic candidate at a time
- one browser review pass per candidate

The browser agent should not yet:

- scan multiple markets on its own
- discover symbols independently
- invent a brand-new setup without a deterministic candidate

---

## Visible Agent Execution

The desired UX is that the user can **see the agent moving around**, not just receive the final answer.

That means the prototype should support a **visible browser session**, not only a hidden headless run.

### Execution modes

#### 1. Headless mode

Use when:

- speed matters more than observation
- no human needs to watch the browser

Properties:

- no visible clicking or panning
- useful for background automation

#### 2. Visible interactive mode

Use when:

- the user wants to watch the agent inspect the chart
- we want the system to feel inspectable and auditable

Properties:

- the browser is visibly opened
- chart zoom / pan / timeframe changes can be seen
- line inspection behavior is observable

For this project, the first meaningful prototype should prefer:

- **visible interactive mode**

because the whole point is not only correct output, but also confidence in how the agent arrived there.

### Implication for tooling

If the browser must be visibly observed:

- a purely hidden headless-only flow is not enough by itself
- the agent runtime needs either:
  - a headed browser
  - or a streamed/inspectable browser session

So:

- **headless browser support is useful**
- but **visible browser control is the real requirement** for the user-facing prototype

---

## Step 3 Decision: Remote Embedded Browser Session

For the first visible prototype, use:

- a **remote embedded browser session**
- rendered inside the app UI
- with the agent controlling that session

This means the user does **not** need to watch a separate local browser window.
The browser surface should appear inside Arena as the agent’s inspection panel.

---

## What This Implies Technically

The system now needs three distinct layers:

### 1. Strategy layer

Already defined:

- deterministic pre-filter proposes candidate
- browser agent inspects and corrects

### 2. Browser execution layer

This is the actual automated browser runtime.

Responsibilities:

- open the chart page
- switch symbol and timeframe
- pan / zoom / inspect
- expose a live session the user can watch

### 3. Session presentation layer

This is the embedded UI inside Arena.

Responsibilities:

- show the live browser view
- show the agent’s current step/status
- allow observation of pointer movement / page changes
- later, optionally allow pause / resume / handoff

---

## Important Constraint: Headless vs Visible

This is the core tradeoff.

### Pure headless browser

Examples:

- Lightpanda in purely headless mode

Good for:

- fast automation
- low resource cost
- backend-only tasks

Not enough by itself for this prototype because:

- the user cannot naturally watch the browser move
- there is no built-in visual session to embed

### Remote embedded visible session

Good for:

- observable agent actions
- auditability
- user trust

Needed for this prototype because:

- you explicitly want to see the agent move around, click, zoom, and inspect

So the practical rule is:

- **headless execution alone is insufficient**
- we need a browser runtime that can be **streamed or embedded**

---

## Where Lightpanda Fits

Lightpanda is still useful, but only in one of these roles:

### Role A: hidden execution engine

Use Lightpanda for:

- background chart automation
- backend visual extraction

But then we would still need a **separate presentation layer** to make it observable.

### Role B: later optimization

Start with a more mature observable browser stack for the first prototype, then consider Lightpanda later for:

- cost reduction
- faster non-visual runs
- background re-checks

For the first user-facing embedded prototype, the safer assumption is:

- **use a browser stack that already supports visible session control**

---

## Recommended First Prototype Architecture

### Candidate flow

1. deterministic third-touch engine emits one candidate
2. Arena starts a browser review session
3. embedded browser opens Deriv
4. agent inspects:
   - regime
   - `T1`
   - `T2`
   - invalidation rollover
   - projected `T3` zone
5. agent returns corrected structure
6. Arena persists corrections
7. replay updates from corrected structure

### Embedded session UI should show

- browser viewport
- current agent step
- active symbol/timeframe
- review verdict once complete

Optional later controls:

- pause
- resume
- stop
- accept/re-run

---

## Minimal First Embedded Session Contract

```ts
type ThirdTouchBrowserSession = {
  sessionId: string;
  marketSymbol: string;
  timeframe: "1h";
  status:
    | "starting"
    | "loading_chart"
    | "inspecting_structure"
    | "adjusting_anchors"
    | "writing_decision"
    | "completed"
    | "failed";
  mode: "embedded-visible";
  inspectedOn: "deriv";
  candidateId: string;
};
```

---

## Recommended Separation of Responsibilities

### Convex

Should own:

- candidate creation
- session lifecycle state
- corrected result persistence
- replay update triggers

### Browser worker/runtime

Should own:

- actual browser control
- page interaction
- extracting visible judgment
- returning structured review

### Next.js frontend

Should own:

- embedded session frame
- session status UI
- replay/result rendering

---

## Next Implementation Question

Before building the embedded agent session, one architecture choice still matters:

- should the browser runtime be optimized first for **implementation speed**
- or for **long-term infra efficiency**

That determines whether the first prototype should use:

- a more mature observable browser stack first
- or attempt a Lightpanda-centered flow immediately

---

## Step 4 Decision: Optimize for Long-Term Infra Efficiency

The chosen direction is:

- **optimize for long-term infra efficiency first**

This means the browser-agent prototype should be designed around:

- a lighter browser-core path
- minimal wasted rendering overhead
- a transport/presentation layer added on top of that core

### Practical consequence

Do **not** design the system around a heavyweight visible browser first and only later try to shrink it down.

Instead:

1. define a lean browser-control core
2. define a session-state protocol
3. define a visible embedded presentation layer on top

That way:

- the control/runtime model stays efficient
- only the presentation layer changes between:
  - hidden automation
  - embedded visible review

### What this implies for Lightpanda

Lightpanda becomes a plausible first-class candidate for:

- browser execution core
- navigation / interaction runtime
- lower-cost repeated reviews

But there is still an important constraint:

- Lightpanda alone does not magically solve the **visible embedded session** requirement

So the architecture should assume:

- **lean browser core**
- **separate observable session layer**

### Recommended implementation stance

Build the system in two planes:

#### Plane A: Control plane

Owns:

- open page
- click
- zoom
- pan
- inspect DOM / chart state
- return structured review output

This is where long-term efficiency matters most.

#### Plane B: Presentation plane

Owns:

- embedded viewport shown in Arena
- session status
- observable pointer / action feedback
- playback of what the agent is doing

This lets us keep the execution side lean while still giving the user a visible session.

---

## Step 5 Decision: Show the Live Remote Browser Viewport

For the first real prototype, the embedded session should show:

- the **actual live remote browser viewport**

Not:

- a simulated or reconstructed observer view

### Why

The goal is not only to know the agent's conclusion.
The goal is to visibly trust the path it took:

- where it navigated
- what it zoomed into
- what it clicked
- what structure it focused on

So the presentation layer should embed the real browser session itself.

### Implication

The system now needs:

1. a browser runtime that can be remotely controlled
2. a way to stream or embed that live viewport into Arena
3. a session lifecycle model that keeps browser state and Arena state synchronized

This is more demanding than a simulated observer layer, but it is more aligned with the intended UX.

---

## Step 6 Decision: Prove the Live Embedded Browser Session First

For the first implementation path, prioritize:

- **proving the live embedded browser session first**

Reason:

- the agent must visibly operate the chart UI
- it needs to switch chart tabs / symbol context / timeframe
- we need to know the browser control layer is real before relying on it for strategy correction

This means the first prototype should answer:

1. can the agent open the chart reliably?
2. can the agent switch to the intended pair?
3. can the agent switch timeframe?
4. can the user watch this happen inside Arena?

Only after that is proven should we rely on the browser agent for:

- correcting `T1`
- correcting `T2`
- correcting the projected `T3` zone

---

## First Implementation Objective

The first implementation should **not** try to solve the full trading loop yet.

It should prove the browser control substrate by completing this narrow flow:

1. start an embedded remote browser session
2. load Deriv chart
3. switch to target symbol
4. switch to target timeframe
5. show the live session inside Arena
6. expose session status back into Convex/UI

Success criteria:

- user can see the live chart session in Arena
- the agent can visibly navigate the chart UI
- the pair/timeframe change is reliable and repeatable

After that, phase two is:

- use the same session to visually inspect and correct third-touch structure

---

## Recommended Output Form for Step 2

For the first working loop, the browser-agent should return:

```ts
type ThirdTouchBrowserReview = {
  marketSymbol: string;
  timeframe: "1h";
  inspectedOn: "deriv";
  comparedAgainstArena: true;
  regimeAssessment: "bullish" | "bearish" | "mixed";
  chosenDirection: "long" | "short" | "none";
  correctedAnchors: {
    t1?: {
      barIndex?: number;
      timeSec?: number;
      price: number;
    };
    t2?: {
      barIndex?: number;
      timeSec?: number;
      price: number;
    };
  };
  correctedZone?: {
    zoneLow: number;
    zoneHigh: number;
    projectedLinePrice: number;
  };
  verdict: "valid" | "staged" | "invalid" | "reject";
  rationale: string;
  confidence: number;
};
```
