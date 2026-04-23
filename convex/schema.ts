import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const visualPoint = v.object({
  barIndex: v.number(),
  price: v.number(),
});

const visualGeometry = v.union(
  v.object({
    kind: v.literal("line"),
    start: visualPoint,
    end: visualPoint,
    tone: v.optional(
      v.union(
        v.literal("default"),
        v.literal("muted"),
        v.literal("entry"),
        v.literal("stop"),
        v.literal("target"),
        v.literal("zone"),
      ),
    ),
  }),
  v.object({
    kind: v.literal("fibonacci"),
    startBarIndex: v.number(),
    endBarIndex: v.number(),
    highPrice: v.number(),
    lowPrice: v.number(),
    levels: v.optional(v.array(v.number())),
  }),
  v.object({
    kind: v.literal("zone"),
    startBarIndex: v.number(),
    endBarIndex: v.number(),
    highPrice: v.number(),
    lowPrice: v.number(),
    tone: v.optional(
      v.union(
        v.literal("default"),
        v.literal("muted"),
        v.literal("entry"),
        v.literal("stop"),
        v.literal("target"),
        v.literal("zone"),
      ),
    ),
  }),
  v.object({
    kind: v.literal("marker"),
    position: visualPoint,
    text: v.string(),
    tone: v.optional(
      v.union(
        v.literal("default"),
        v.literal("muted"),
        v.literal("entry"),
        v.literal("stop"),
        v.literal("target"),
        v.literal("zone"),
      ),
    ),
  }),
);

export default defineSchema({
  agents: defineTable({
    slug: v.string(),
    name: v.string(),
    strategyLabel: v.string(),
    status: v.union(
      v.literal("scanning"),
      v.literal("watchlist"),
      v.literal("ready"),
      v.literal("entered"),
      v.literal("monitoring"),
      v.literal("closed"),
    ),
    primaryMarket: v.string(),
    timeframe: v.union(v.literal("15m"), v.literal("1h"), v.literal("4h")),
    trackedMarkets: v.array(v.string()),
    winRate: v.number(),
    pnlPercent: v.number(),
    openPositions: v.number(),
    score: v.number(),
    lastAction: v.string(),
    isActive: v.boolean(),
  })
    .index("by_slug", ["slug"])
    .index("by_active", ["isActive"]),

  markets: defineTable({
    symbol: v.string(),
    displayName: v.string(),
    assetClass: v.union(v.literal("commodity"), v.literal("forex")),
    price: v.number(),
    changePercent: v.number(),
    dailyRange: v.string(),
    sessionBias: v.union(
      v.literal("bullish"),
      v.literal("bearish"),
      v.literal("mixed"),
    ),
    source: v.optional(v.string()),
    lastUpdatedAt: v.optional(v.number()),
    newsState: v.optional(
      v.union(
        v.literal("supportive"),
        v.literal("neutral"),
        v.literal("risk"),
      ),
    ),
    newsRationale: v.optional(v.string()),
    newsUpdatedAt: v.optional(v.number()),
  }).index("by_symbol", ["symbol"]),

  newsContexts: defineTable({
    agentSlug: v.optional(v.string()),
    marketSymbol: v.string(),
    headline: v.string(),
    state: v.union(
      v.literal("supportive"),
      v.literal("neutral"),
      v.literal("risk"),
    ),
    sourceLabel: v.string(),
    publishedAtLabel: v.string(),
    note: v.string(),
    rationale: v.optional(v.string()),
    url: v.optional(v.string()),
  }).index("by_marketSymbol", ["marketSymbol"]),

  watchlistItems: defineTable({
    agentSlug: v.string(),
    marketSymbol: v.string(),
    setupLabel: v.string(),
    timeframe: v.union(v.literal("15m"), v.literal("1h"), v.literal("4h")),
    status: v.union(v.literal("watching"), v.literal("armed")),
    triggerNote: v.string(),
    confluenceState: v.union(
      v.literal("supportive"),
      v.literal("neutral"),
      v.literal("risk"),
    ),
    source: v.union(v.literal("mock"), v.literal("engine")),
  })
    .index("by_agentSlug", ["agentSlug"])
    .index("by_agentSlug_marketSymbol", ["agentSlug", "marketSymbol"]),

  tradeIdeas: defineTable({
    agentSlug: v.string(),
    marketSymbol: v.string(),
    direction: v.union(v.literal("long"), v.literal("short")),
    status: v.union(
      v.literal("watchlist"),
      v.literal("ready"),
      v.literal("entered"),
      v.literal("closed"),
    ),
    entry: v.number(),
    stopLoss: v.number(),
    takeProfit: v.number(),
    confidence: v.number(),
    confluenceState: v.union(
      v.literal("supportive"),
      v.literal("neutral"),
      v.literal("risk"),
    ),
    thesis: v.string(),
    source: v.union(v.literal("mock"), v.literal("engine")),
  })
    .index("by_agentSlug", ["agentSlug"])
    .index("by_agentSlug_marketSymbol", ["agentSlug", "marketSymbol"]),

  positions: defineTable({
    agentSlug: v.string(),
    marketSymbol: v.string(),
    direction: v.union(v.literal("long"), v.literal("short")),
    timeframe: v.union(v.literal("15m"), v.literal("1h"), v.literal("4h")),
    entry: v.number(),
    markPrice: v.number(),
    stopLoss: v.number(),
    takeProfit: v.number(),
    pnlPercent: v.number(),
    progressLabel: v.string(),
    nextCheckIn: v.string(),
    source: v.union(v.literal("mock"), v.literal("engine")),
  })
    .index("by_agentSlug", ["agentSlug"])
    .index("by_agentSlug_marketSymbol", ["agentSlug", "marketSymbol"]),

  tradeEvents: defineTable({
    agentSlug: v.string(),
    marketSymbol: v.string(),
    timestampLabel: v.string(),
    title: v.string(),
    detail: v.string(),
    stage: v.union(
      v.literal("scanning"),
      v.literal("watchlist"),
      v.literal("ready"),
      v.literal("entered"),
      v.literal("monitoring"),
      v.literal("closed"),
    ),
    source: v.union(v.literal("mock"), v.literal("engine")),
  })
    .index("by_agentSlug", ["agentSlug"])
    .index("by_agentSlug_marketSymbol", ["agentSlug", "marketSymbol"]),

  visualTraces: defineTable({
    agentSlug: v.string(),
    marketSymbol: v.string(),
    timeframe: v.union(v.literal("15m"), v.literal("1h"), v.literal("4h")),
    updatedAtLabel: v.string(),
    source: v.union(v.literal("mock"), v.literal("engine")),
    annotations: v.array(
      v.object({
        annotationId: v.string(),
        type: v.union(
          v.literal("trendline"),
          v.literal("fibonacci"),
          v.literal("zone"),
          v.literal("entry"),
          v.literal("stop-loss"),
          v.literal("take-profit"),
          v.literal("note"),
        ),
        label: v.string(),
        detail: v.string(),
        revealStep: v.optional(v.number()),
        geometry: v.optional(visualGeometry),
      }),
    ),
  })
    .index("by_agentSlug", ["agentSlug"])
    .index("by_agentSlug_marketSymbol", ["agentSlug", "marketSymbol"]),

  leaderboardSnapshots: defineTable({
    season: v.string(),
    agentSlug: v.string(),
    score: v.number(),
    pnlPercent: v.number(),
    openPositions: v.number(),
    capturedAt: v.number(),
  }).index("by_season", ["season"]),

  scanRuns: defineTable({
    agentSlug: v.string(),
    marketSymbol: v.string(),
    timeframe: v.union(v.literal("15m"), v.literal("1h"), v.literal("4h")),
    result: v.union(v.literal("success"), v.literal("error")),
    source: v.string(),
    startedAt: v.number(),
    finishedAt: v.number(),
    note: v.optional(v.string()),
    error: v.optional(v.string()),
  })
    .index("by_startedAt", ["startedAt"])
    .index("by_agentSlug_startedAt", ["agentSlug", "startedAt"]),
});
