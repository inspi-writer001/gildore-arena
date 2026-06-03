# Arena Drift Audit

Date: 2026-06-01

This document captures where Gildore Arena has drifted away from the current implementation model, especially around background scanning, freshness labels, market support, and placeholder data.

## Current Architecture

There are two separate background systems:

1. Browser review worker
   - File: [worker/src/index.ts](/home/inspiration-gx/Documents/gildore-project/gildore-arena/worker/src/index.ts:1)
   - Purpose: claim due analysis jobs, open Deriv charts, capture screenshots, run vision analysis, persist setup state
   - Deployment target: DigitalOcean worker

2. Convex cron scan cycle
   - File: [convex/arena.ts](/home/inspiration-gx/Documents/gildore-project/gildore-arena/convex/arena.ts:2406)
   - Purpose: fetch Pyth candles, fetch market news, fetch economic calendar, update market confluence, generate engine-derived state
   - Runtime: Convex scheduled job every 5 minutes

These are independent. Redeploying the DigitalOcean worker does not fix stale market/news freshness.

## Drift Summary

### 1. Market freshness in the UI is not tied to the worker

Status: Drift

- Market cards render freshness from `market.newsUpdatedAt`
  - [components/arena/selected-agent-panel.tsx](/home/inspiration-gx/Documents/gildore-project/gildore-arena/components/arena/selected-agent-panel.tsx:258)
- That timestamp is updated by the Convex cron scan path, not by the browser worker
  - [convex/arena.ts](/home/inspiration-gx/Documents/gildore-project/gildore-arena/convex/arena.ts:1409)

Impact:
- A market can show `35d` even while the browser worker is healthy
- This makes the UI misleading because users naturally interpret it as “the system is not scanning”

Recommendation:
- Rename or reframe this freshness label in the UI as `news sync` or `market sync`
- Stop implying it represents browser-analysis freshness

### 2. Background news scanning exists, but coverage is incomplete

Status: Drift

Current support by layer:

- News ingestion supports only:
  - `XAU/USD`
  - `XAG/USD`
  - `EUR/USD`
  - File: [lib/news-ingestion.ts](/home/inspiration-gx/Documents/gildore-project/gildore-arena/lib/news-ingestion.ts:20)

- Economic calendar supports only:
  - `XAU/USD`
  - `XAG/USD`
  - `EUR/USD`
  - File: [lib/economic-calendar.ts](/home/inspiration-gx/Documents/gildore-project/gildore-arena/lib/economic-calendar.ts:33)

- Pyth history supports:
  - `XAU/USD`
  - `XAG/USD`
  - `EUR/USD`
  - `GBP/USD`
  - `USD/JPY`
  - File: [lib/pyth-history.ts](/home/inspiration-gx/Documents/gildore-project/gildore-arena/lib/pyth-history.ts:13)

But Kairos currently tracks unsupported synthetics too:
- `Volatility 10 Index`
- `Crash 1000 Index`
- File: [convex/arena.ts](/home/inspiration-gx/Documents/gildore-project/gildore-arena/convex/arena.ts:2382)

Impact:
- Some markets shown in the UI cannot be refreshed by the cron scan path
- Their freshness will naturally drift stale even if everything is “working as coded”

Recommendation:
- Choose one of these paths:
  - Limit tracked markets to symbols fully supported by background scanning
  - Or explicitly mark unsupported markets in the UI
  - Or build a separate background source for synthetic/Deriv-only symbols

### 3. Placeholder seeded confluence still behaves like live data

Status: Drift

Seeded markets get:
- `newsState`
- `newsRationale`
- `newsUpdatedAt`
- from placeholder values in:
  - [convex/arena.ts](/home/inspiration-gx/Documents/gildore-project/gildore-arena/convex/arena.ts:708)
  - [convex/arena.ts](/home/inspiration-gx/Documents/gildore-project/gildore-arena/convex/arena.ts:2356)

Seeded news contexts also use placeholder wording:
- [convex/arena.ts](/home/inspiration-gx/Documents/gildore-project/gildore-arena/convex/arena.ts:723)

Impact:
- Markets can carry fake freshness and fake rationale until a real scan replaces them
- There is no schema-level distinction between seeded placeholders and live-convex scan output

Recommendation:
- Add a field like `confluenceSource: "seed" | "scan"` or `isPlaceholder: boolean`
- Do not show placeholder freshness as if it were a live sync timestamp

### 4. Failure states are invisible in the market cards

Status: Drift

The cron scan cycle records failures in `scanRuns`:
- [convex/arena.ts](/home/inspiration-gx/Documents/gildore-project/gildore-arena/convex/arena.ts:1474)

But market cards only show:
- `market.newsState`
- `market.newsUpdatedAt`

There is no UI state for:
- last scan failed
- symbol unsupported
- no recent live sync

Impact:
- `35d` could mean:
  - cron never ran
  - cron failed
  - symbol unsupported
  - placeholder never got replaced
- the user cannot tell which one is true

Recommendation:
- Add a market-level sync state derived from the latest relevant `scanRuns`
- Suggested states:
  - `live`
  - `stale`
  - `failed`
  - `unsupported`

### 5. Freshness formatting is duplicated and semantically overloaded

Status: Drift

There are two `formatNewsFreshness` functions:
- [components/arena/arena-shared.tsx](/home/inspiration-gx/Documents/gildore-project/gildore-arena/components/arena/arena-shared.tsx:43)
- [components/arena/selected-agent-panel.tsx](/home/inspiration-gx/Documents/gildore-project/gildore-arena/components/arena/selected-agent-panel.tsx:89)

The same formatter is used for:
- market news freshness
- setup review freshness
  - [components/arena/selected-agent-panel.tsx](/home/inspiration-gx/Documents/gildore-project/gildore-arena/components/arena/selected-agent-panel.tsx:503)

Impact:
- Two different backend concepts are labeled with the same UI language
- This causes conceptual drift in the product surface

Recommendation:
- Keep one shared formatter only
- Split semantics:
  - `formatSyncFreshness`
  - `formatReviewFreshness`

### 6. Persisted relative labels are brittle

Status: Drift

News and calendar ingest persist pre-rendered strings:
- `publishedAtLabel`
  - [lib/news-ingestion.ts](/home/inspiration-gx/Documents/gildore-project/gildore-arena/lib/news-ingestion.ts:197)
  - [lib/economic-calendar.ts](/home/inspiration-gx/Documents/gildore-project/gildore-arena/lib/economic-calendar.ts:208)

Those strings are stored in Convex:
- [convex/schema.ts](/home/inspiration-gx/Documents/gildore-project/gildore-arena/convex/schema.ts:116)
- [convex/arena.ts](/home/inspiration-gx/Documents/gildore-project/gildore-arena/convex/arena.ts:1080)

Impact:
- Relative strings like `35d ago` become stale by definition
- The UI cannot re-render accurate relative time because the raw timestamp is discarded

Recommendation:
- Store raw times:
  - `publishedAtMs`
  - `eventAtMs`
- Compute relative labels only in the frontend

### 7. `scanRuns` exists but is not surfaced where it matters

Status: Drift

`scanRuns` is collected in the snapshot:
- [convex/arena.ts](/home/inspiration-gx/Documents/gildore-project/gildore-arena/convex/arena.ts:577)

And `lastScanAt` is derived in the dashboard:
- [components/arena-dashboard.tsx](/home/inspiration-gx/Documents/gildore-project/gildore-arena/components/arena-dashboard.tsx:744)

But it is not clearly shown in the current inline agent detail where freshness confusion happens.

Impact:
- The data needed to explain background scanning exists
- The UI does not expose it where users are asking the question

Recommendation:
- Add a small diagnostics line in the agent detail:
  - `Last market sync`
  - `Last analysis review`
  - `Last browser review`

### 8. Trade/analysis freshness and market/news freshness are separate systems

Status: Drift

Current state sources:
- Market/news freshness:
  - `markets.newsUpdatedAt`
  - updated by Convex cron
- Strategy setup review freshness:
  - `strategySetups.lastReviewedAt`
  - updated by worker/vision persistence
- Browser review lifecycle:
  - `analysisJobs`, `analysisSchedules`, `browserSessions`

Impact:
- The UI currently collapses these into a single mental model
- The implementation does not

Recommendation:
- Make these separate in the UI and naming:
  - `Market sync`
  - `Setup review`
  - `Browser review`

## Priority Cleanup Plan

### P0: Clarify and stop misleading freshness

Goal:
- Make the UI honest before changing architecture

Tasks:
1. Replace market-card freshness wording with `news sync` or `market sync`
2. Remove duplicate `formatNewsFreshness`
3. Stop using the same formatter label for `lastReviewedAt`
4. Surface `Last market sync` and `Last setup review` separately

Files:
- [components/arena/selected-agent-panel.tsx](/home/inspiration-gx/Documents/gildore-project/gildore-arena/components/arena/selected-agent-panel.tsx)
- [components/arena/arena-shared.tsx](/home/inspiration-gx/Documents/gildore-project/gildore-arena/components/arena/arena-shared.tsx)

### P1: Distinguish seeded, live, failed, unsupported market confluence

Goal:
- Make DB state explainable

Tasks:
1. Add a field on `markets` to describe confluence source/status
2. Mark seeded rows explicitly
3. Mark unsupported symbols explicitly
4. Patch cron failures into a market-visible status, not just `scanRuns`

Files:
- [convex/schema.ts](/home/inspiration-gx/Documents/gildore-project/gildore-arena/convex/schema.ts)
- [convex/arena.ts](/home/inspiration-gx/Documents/gildore-project/gildore-arena/convex/arena.ts)

### P2: Normalize market coverage

Goal:
- Make tracked symbols match backend support

Options:
1. Restrict tracked markets to symbols supported by Pyth + news/calendar
2. Keep synthetics visible but mark them `browser-only`
3. Build a synthetic-market background source later

Likely first move:
- mark synthetic symbols as unsupported in the market sync layer

Files:
- [convex/arena.ts](/home/inspiration-gx/Documents/gildore-project/gildore-arena/convex/arena.ts:2382)
- [lib/pyth-history.ts](/home/inspiration-gx/Documents/gildore-project/gildore-arena/lib/pyth-history.ts)
- [lib/news-ingestion.ts](/home/inspiration-gx/Documents/gildore-project/gildore-arena/lib/news-ingestion.ts)
- [lib/economic-calendar.ts](/home/inspiration-gx/Documents/gildore-project/gildore-arena/lib/economic-calendar.ts)

### P3: Stop storing relative-time labels in the DB

Goal:
- Eliminate stale presentation drift

Tasks:
1. Add raw timestamps to `newsContexts`
2. Keep relative formatting in the frontend only
3. Migrate old rows or tolerate mixed shape during rollout

Files:
- [convex/schema.ts](/home/inspiration-gx/Documents/gildore-project/gildore-arena/convex/schema.ts)
- [convex/arena.ts](/home/inspiration-gx/Documents/gildore-project/gildore-arena/convex/arena.ts)
- [lib/news-ingestion.ts](/home/inspiration-gx/Documents/gildore-project/gildore-arena/lib/news-ingestion.ts)
- [lib/economic-calendar.ts](/home/inspiration-gx/Documents/gildore-project/gildore-arena/lib/economic-calendar.ts)
- [components/arena-dashboard.tsx](/home/inspiration-gx/Documents/gildore-project/gildore-arena/components/arena-dashboard.tsx)

## Recommended Keep / Remove Decisions

Keep:
- `runArenaScanCycle` cron architecture
- browser worker for chart review
- `scanRuns`, `analysisSchedules`, `analysisJobs`

Remove or refactor:
- duplicate freshness formatters
- placeholder confluence pretending to be live state
- persisted relative labels
- unsupported symbols treated the same as fully supported markets

## Suggested Execution Order

1. Fix frontend freshness wording and expose separate statuses
2. Add explicit market sync status in schema/backend
3. Mark unsupported synthetic markets clearly
4. Remove persisted relative labels and move to raw timestamps
5. Decide whether synthetics get a real background source or stay browser-only

## Best Immediate Next Patch

If we want the highest-value cleanup first, do this:

1. Add `marketSyncStatus` to markets
   - `seeded`
   - `live`
   - `failed`
   - `unsupported`

2. Update the market cards to show:
   - status badge
   - sync freshness
   - not just `35d`

3. Stop using `formatNewsFreshness` for setup review timestamps

That will make the current system understandable before deeper backend changes.
