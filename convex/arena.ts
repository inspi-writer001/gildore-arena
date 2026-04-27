import { cronJobs } from "convex/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import {
  agents as mockAgents,
  markets as mockMarkets,
  newsContexts as mockNewsContexts,
  watchlistItems as mockWatchlistItems,
} from "../lib/arena-mock-data";
import { fetchMarketCalendar } from "../lib/economic-calendar";
import { deriveFibonacciArenaState } from "../lib/fibonacci-engine";
import { fetchMarketNews } from "../lib/news-ingestion";
import { fetchPythHistory } from "../lib/pyth-history";
import { deriveThirdTouchArenaState } from "../lib/third-touch-engine";

export const listAgents = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("agents").collect();
  },
});

function latestByKey<T>(
  rows: T[],
  getKey: (row: T) => string,
  getCreatedAt: (row: T) => number,
) {
  const latest = new Map<string, T>();

  for (const row of rows) {
    const key = getKey(row);
    const current = latest.get(key);

    if (!current || getCreatedAt(row) > getCreatedAt(current)) {
      latest.set(key, row);
    }
  }

  return Array.from(latest.values());
}

function latestTradeEventBatches<
  T extends {
    agentSlug: string;
    marketSymbol: string;
    _creationTime: number;
    eventTimeSec?: number;
  },
>(rows: T[], batchSize = 3) {
  const grouped = new Map<string, T[]>();

  for (const row of rows) {
    const key = `${row.agentSlug}:${row.marketSymbol}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(row);
    grouped.set(key, bucket);
  }

  return Array.from(grouped.values())
    .flatMap((bucket) =>
      bucket
        .sort((a, b) => a._creationTime - b._creationTime)
        .slice(-batchSize)
        .sort((a, b) => {
          const timeDelta = (a.eventTimeSec ?? 0) - (b.eventTimeSec ?? 0);
          return timeDelta !== 0 ? timeDelta : a._creationTime - b._creationTime;
        }),
    );
}

function deriveAgentStatus(args: {
  openPositions: number;
  tradeIdeaStatuses: Array<"watchlist" | "ready" | "entered" | "closed">;
}) {
  if (args.openPositions > 0) return "monitoring" as const;
  if (args.tradeIdeaStatuses.includes("entered")) return "entered" as const;
  if (args.tradeIdeaStatuses.includes("ready")) return "ready" as const;
  if (args.tradeIdeaStatuses.includes("watchlist")) return "watchlist" as const;
  return "scanning" as const;
}

function deriveArenaScore(args: {
  pnlPercent: number;
  openPositions: number;
  tradeIdeaStatuses: Array<"watchlist" | "ready" | "entered" | "closed">;
}) {
  const enteredIdeas = args.tradeIdeaStatuses.filter(
    (status) => status === "entered",
  ).length;
  const readyIdeas = args.tradeIdeaStatuses.filter(
    (status) => status === "ready",
  ).length;
  const watchlistIdeas = args.tradeIdeaStatuses.filter(
    (status) => status === "watchlist",
  ).length;
  const closedIdeas = args.tradeIdeaStatuses.filter(
    (status) => status === "closed",
  ).length;

  return Math.max(
    0,
    Math.round(
      1000 +
        args.pnlPercent * 35 +
        args.openPositions * 24 +
        enteredIdeas * 18 +
        readyIdeas * 10 +
        watchlistIdeas * 4 +
        closedIdeas * 14,
    ),
  );
}

function formatMarketValue(symbol: string, value: number) {
  return symbol === "EUR/USD" ? value.toFixed(4) : value.toFixed(2);
}

function deriveSessionBias(close: number, previousClose: number) {
  const deltaPercent =
    previousClose === 0 ? 0 : ((close - previousClose) / previousClose) * 100;

  if (deltaPercent > 0.18) return "bullish" as const;
  if (deltaPercent < -0.18) return "bearish" as const;
  return "mixed" as const;
}

function mergeMarketConfluence(args: {
  news: {
    overallState: "supportive" | "neutral" | "risk";
    overallReason: string;
    items: Array<{
      headline: string;
      state: "supportive" | "neutral" | "risk";
      sourceLabel: string;
      publishedAtLabel: string;
      note: string;
      url?: string;
    }>;
  };
  calendar: {
    overallState: "supportive" | "neutral" | "risk";
    overallReason: string;
    items: Array<{
      headline: string;
      state: "supportive" | "neutral" | "risk";
      sourceLabel: string;
      publishedAtLabel: string;
      note: string;
      url?: string;
    }>;
  };
}) {
  const overallState =
    args.calendar.overallState === "risk"
      ? "risk"
      : args.news.overallState;

  let overallReason = args.news.overallReason;

  if (args.calendar.overallState === "risk") {
    overallReason =
      args.news.overallState === "supportive"
        ? `${args.calendar.overallReason} Headline flow is constructive, but scheduled macro risk still overrides execution.`
        : args.calendar.overallReason;
  } else if (args.news.overallState === "neutral" && args.calendar.items.length) {
    overallReason = args.calendar.overallReason;
  }

  return {
    overallState,
    overallReason,
    items: [...args.calendar.items, ...args.news.items].slice(0, 10),
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type BrowserEventStatus = "queued" | "running" | "completed" | "failed";

function resolveBrowserReviewTarget(args: {
  marketSymbol: string;
  timeframe: "15m" | "1h" | "4h";
}) {
  if (args.marketSymbol === "XAG/USD" || args.marketSymbol === "XAU/USD" || args.marketSymbol === "EUR/USD") {
    return {
      browserTargetSymbol: "Volatility 10 (1s) Index",
      browserTargetTimeframe: "4h",
      reason:
        "Weekend browser review is pinned to a public derived volatility chart until metals and FX sessions reopen.",
    };
  }

  return {
    browserTargetSymbol: args.marketSymbol,
    browserTargetTimeframe: args.timeframe,
    reason: "Browser review targets the same market and timeframe as the arena state.",
  };
}

export const getArenaSnapshot = query({
  args: {},
  handler: async (ctx) => {
    const [
      agents,
      markets,
      newsContexts,
      watchlistItems,
      tradeIdeas,
      positions,
      tradeEvents,
      visualTraces,
      browserSessions,
      browserSessionEvents,
      leaderboardSnapshots,
      scanRuns,
      visionDecisions,
    ] = await Promise.all([
      ctx.db.query("agents").collect(),
      ctx.db.query("markets").collect(),
      ctx.db.query("newsContexts").collect(),
      ctx.db.query("watchlistItems").collect(),
      ctx.db.query("tradeIdeas").collect(),
      ctx.db.query("positions").collect(),
      ctx.db.query("tradeEvents").collect(),
      ctx.db.query("visualTraces").collect(),
      ctx.db.query("browserSessions").collect(),
      ctx.db.query("browserSessionEvents").collect(),
      ctx.db.query("leaderboardSnapshots").collect(),
      ctx.db.query("scanRuns").collect(),
      ctx.db.query("visionDecisions").collect(),
    ]);

    return {
      agents: agents.sort((a, b) => b.score - a.score),
      markets: markets.sort((a, b) => a.symbol.localeCompare(b.symbol)),
      newsContexts: latestByKey(
        newsContexts,
        (row) => `${row.agentSlug ?? "global"}:${row.marketSymbol}:${row.headline}`,
        (row) => row._creationTime,
      ),
      watchlistItems: latestByKey(
        watchlistItems,
        (row) => `${row.agentSlug}:${row.marketSymbol}`,
        (row) => row._creationTime,
      ),
      tradeIdeas: latestByKey(
        tradeIdeas,
        (row) => `${row.agentSlug}:${row.marketSymbol}`,
        (row) => row._creationTime,
      ),
      positions: latestByKey(
        positions,
        (row) => `${row.agentSlug}:${row.marketSymbol}`,
        (row) => row._creationTime,
      ),
      tradeEvents: latestTradeEventBatches(tradeEvents),
      visualTraces: latestByKey(
        visualTraces,
        (row) => `${row.agentSlug}:${row.marketSymbol}`,
        (row) => row._creationTime,
      ),
      browserSessions: latestByKey(
        browserSessions,
        (row) => `${row.agentSlug}:${row.marketSymbol}`,
        (row) => row._creationTime,
      ),
      browserSessionEvents: browserSessionEvents.sort(
        (a, b) =>
          a._creationTime - b._creationTime || a.sequence - b.sequence,
      ),
      leaderboardSnapshots: leaderboardSnapshots.sort(
        (a, b) => b.capturedAt - a.capturedAt,
      ),
      scanRuns: scanRuns.sort((a, b) => b.startedAt - a.startedAt),
      visionDecisions: latestByKey(
        visionDecisions,
        (row) => `${row.agentSlug}:${row.marketSymbol}`,
        (row) => row.capturedAt,
      ),
    };
  },
});

export const listActiveAgents = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("agents")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();
  },
});

export const seedArena = mutation({
  args: {},
  handler: async (ctx) => {
    const existingAgents = await ctx.db.query("agents").collect();
    if (existingAgents.length > 0) {
      return { seeded: false, reason: "Agents already exist." };
    }

    for (const agent of mockAgents) {
      await ctx.db.insert("agents", {
        slug: agent.id,
        name: agent.name,
        strategyLabel: agent.strategyLabel,
        status: agent.status,
        primaryMarket: agent.primaryMarket,
        timeframe: agent.timeframe,
        trackedMarkets: Array.from(
          new Set([
            agent.primaryMarket,
            ...mockWatchlistItems
              .filter((item) => item.agentId === agent.id)
              .map((item) => item.marketSymbol),
          ]),
        ),
        winRate: agent.winRate,
        pnlPercent: agent.pnlPercent,
        openPositions: agent.openPositions,
        score: agent.score,
        lastAction: agent.lastAction,
        isActive: true,
      });
    }

    for (const market of mockMarkets) {
      await ctx.db.insert("markets", {
        symbol: market.symbol,
        displayName: market.displayName,
        assetClass: market.assetClass,
        price: market.price,
        changePercent: market.changePercent,
        dailyRange: market.dailyRange,
        sessionBias: market.sessionBias,
        source: "seed",
        lastUpdatedAt: Date.now(),
        newsState: "neutral",
        newsRationale:
          "Seeded placeholder confluence. Replace with live market-wide news after the first scan.",
        newsUpdatedAt: Date.now(),
      });
    }

    for (const item of mockNewsContexts) {
      await ctx.db.insert("newsContexts", {
        marketSymbol: item.marketSymbol,
        headline: item.headline,
        state: item.state,
        sourceLabel: item.sourceLabel,
        publishedAtLabel: item.publishedAt,
        note: item.note,
        rationale:
          "Seeded placeholder confluence. Replace with live news ingestion after the first scan.",
      });
    }

    return { seeded: true };
  },
});

export const createBrowserSession = internalMutation({
  args: {
    agentSlug: v.string(),
    marketSymbol: v.string(),
    timeframe: v.union(v.literal("15m"), v.literal("1h"), v.literal("4h")),
    browserTargetSymbol: v.optional(v.string()),
    browserTargetTimeframe: v.optional(v.string()),
    inspectedOn: v.literal("deriv"),
    targetUrl: v.string(),
    totalSteps: v.number(),
    currentStepLabel: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("browserSessions", {
      agentSlug: args.agentSlug,
      marketSymbol: args.marketSymbol,
      timeframe: args.timeframe,
      browserTargetSymbol: args.browserTargetSymbol,
      browserTargetTimeframe: args.browserTargetTimeframe,
      inspectedOn: args.inspectedOn,
      targetUrl: args.targetUrl,
      status: "starting",
      currentStepLabel: args.currentStepLabel,
      currentStepIndex: 0,
      totalSteps: args.totalSteps,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const setBrowserSessionState = internalMutation({
  args: {
    sessionId: v.id("browserSessions"),
    status: v.union(
      v.literal("starting"),
      v.literal("loading_chart"),
      v.literal("switching_symbol"),
      v.literal("switching_timeframe"),
      v.literal("ready"),
      v.literal("failed"),
      v.literal("completed"),
    ),
    currentStepLabel: v.string(),
    currentStepIndex: v.number(),
    completedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      status: args.status,
      currentStepLabel: args.currentStepLabel,
      currentStepIndex: args.currentStepIndex,
      updatedAt: Date.now(),
      completedAt: args.completedAt,
      error: args.error,
    });
  },
});

export const updateBrowserSessionState = mutation({
  args: {
    sessionId: v.id("browserSessions"),
    status: v.union(
      v.literal("starting"),
      v.literal("loading_chart"),
      v.literal("switching_symbol"),
      v.literal("switching_timeframe"),
      v.literal("ready"),
      v.literal("failed"),
      v.literal("completed"),
    ),
    currentStepLabel: v.string(),
    currentStepIndex: v.number(),
    completedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      status: args.status,
      currentStepLabel: args.currentStepLabel,
      currentStepIndex: args.currentStepIndex,
      updatedAt: Date.now(),
      completedAt: args.completedAt,
      error: args.error,
    });
  },
});

export const clearBrowserSessionEvents = internalMutation({
  args: {
    sessionId: v.id("browserSessions"),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("browserSessionEvents")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
  },
});

export const upsertBrowserSessionEvents = internalMutation({
  args: {
    sessionId: v.id("browserSessions"),
    events: v.array(
      v.object({
        sequence: v.number(),
        label: v.string(),
        detail: v.string(),
        status: v.union(
          v.literal("queued"),
          v.literal("running"),
          v.literal("completed"),
          v.literal("failed"),
        ),
      }),
  ),
  },
  handler: async (ctx, args) => {
    const existingRows = await ctx.db
      .query("browserSessionEvents")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    for (const row of existingRows) {
      await ctx.db.delete(row._id);
    }

    for (const event of args.events) {
      await ctx.db.insert("browserSessionEvents", {
        sessionId: args.sessionId,
        sequence: event.sequence,
        label: event.label,
        detail: event.detail,
        status: event.status,
      });
    }
  },
});

export const replaceBrowserSessionEvents = mutation({
  args: {
    sessionId: v.id("browserSessions"),
    events: v.array(
      v.object({
        sequence: v.number(),
        label: v.string(),
        detail: v.string(),
        status: v.union(
          v.literal("queued"),
          v.literal("running"),
          v.literal("completed"),
          v.literal("failed"),
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existingRows = await ctx.db
      .query("browserSessionEvents")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    for (const row of existingRows) {
      await ctx.db.delete(row._id);
    }

    for (const event of args.events) {
      await ctx.db.insert("browserSessionEvents", {
        sessionId: args.sessionId,
        sequence: event.sequence,
        label: event.label,
        detail: event.detail,
        status: event.status,
      });
    }
  },
});

export const recordScanRun = internalMutation({
  args: {
    agentSlug: v.string(),
    marketSymbol: v.string(),
    timeframe: v.union(v.literal("15m"), v.literal("1h"), v.literal("4h")),
    result: v.union(v.literal("success"), v.literal("error")),
    source: v.string(),
    startedAt: v.number(),
    finishedAt: v.number(),
    note: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("scanRuns", args);
  },
});

export const persistFibonacciDerivedState = internalMutation({
  args: {
    agentSlug: v.string(),
    marketSymbol: v.string(),
    tradeIdea: v.any(),
    watchlistItem: v.any(),
    trace: v.any(),
    events: v.any(),
    position: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("tradeIdeas", {
      agentSlug: args.agentSlug,
      marketSymbol: args.marketSymbol,
      direction: args.tradeIdea.direction,
      status: args.tradeIdea.status,
      entry: args.tradeIdea.entry,
      stopLoss: args.tradeIdea.stopLoss,
      takeProfit: args.tradeIdea.takeProfit,
      confidence: args.tradeIdea.confidence,
      confluenceState: args.tradeIdea.confluenceState,
      thesis: args.tradeIdea.thesis,
      source: "engine",
    });

    await ctx.db.insert("watchlistItems", {
      agentSlug: args.agentSlug,
      marketSymbol: args.marketSymbol,
      setupLabel: args.watchlistItem.setupLabel,
      timeframe: args.watchlistItem.timeframe,
      status: args.watchlistItem.status,
      triggerNote: args.watchlistItem.triggerNote,
      confluenceState: args.watchlistItem.confluenceState,
      source: "engine",
    });

    await ctx.db.insert("visualTraces", {
      agentSlug: args.agentSlug,
      marketSymbol: args.marketSymbol,
      timeframe: args.trace.timeframe,
      updatedAtLabel: args.trace.updatedAt,
      source: "engine",
      annotations: args.trace.annotations.map((annotation: any) => ({
        annotationId: annotation.id,
        type: annotation.type,
        label: annotation.label,
        detail: annotation.detail,
        revealStep: annotation.revealStep,
        geometry: annotation.geometry,
      })),
    });

    for (const event of args.events) {
      await ctx.db.insert("tradeEvents", {
        agentSlug: args.agentSlug,
        marketSymbol: args.marketSymbol,
        timestampLabel: event.timestamp,
        eventTimeSec: event.eventTimeSec,
        title: event.title,
        detail: event.detail,
        stage: event.stage,
        focusKind: event.focusKind,
        source: "engine",
      });
    }

    if (args.position) {
      await ctx.db.insert("positions", {
        agentSlug: args.agentSlug,
        marketSymbol: args.marketSymbol,
        direction: args.position.direction,
        timeframe: args.position.timeframe,
        entry: args.position.entry,
        markPrice: args.position.markPrice,
        stopLoss: args.position.stopLoss,
        takeProfit: args.position.takeProfit,
        pnlPercent: args.position.pnlPercent,
        progressLabel: args.position.progressLabel,
        nextCheckIn: args.position.nextCheckIn,
        source: "engine",
      });
    }
  },
});

export const updateMarketSnapshot = internalMutation({
  args: {
    symbol: v.string(),
    price: v.number(),
    changePercent: v.number(),
    dailyRange: v.string(),
    sessionBias: v.union(
      v.literal("bullish"),
      v.literal("bearish"),
      v.literal("mixed"),
    ),
    source: v.string(),
    lastUpdatedAt: v.number(),
    newsState: v.optional(
      v.union(
        v.literal("supportive"),
        v.literal("neutral"),
        v.literal("risk"),
      ),
    ),
    newsRationale: v.optional(v.string()),
    newsUpdatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const market = await ctx.db
      .query("markets")
      .withIndex("by_symbol", (q) => q.eq("symbol", args.symbol))
      .unique();

    if (!market) {
      return;
    }

    await ctx.db.patch(market._id, {
      price: args.price,
      changePercent: args.changePercent,
      dailyRange: args.dailyRange,
      sessionBias: args.sessionBias,
      source: args.source,
      lastUpdatedAt: args.lastUpdatedAt,
      newsState: args.newsState,
      newsRationale: args.newsRationale,
      newsUpdatedAt: args.newsUpdatedAt,
    });
  },
});

export const persistNewsContexts = internalMutation({
  args: {
    agentSlug: v.optional(v.string()),
    marketSymbol: v.string(),
    overallReason: v.string(),
    items: v.array(
      v.object({
        headline: v.string(),
        state: v.union(
          v.literal("supportive"),
          v.literal("neutral"),
          v.literal("risk"),
        ),
        sourceLabel: v.string(),
        publishedAtLabel: v.string(),
        note: v.string(),
        url: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existingRows = await ctx.db
      .query("newsContexts")
      .withIndex("by_marketSymbol", (q) => q.eq("marketSymbol", args.marketSymbol))
      .collect();

    for (const row of existingRows) {
      const matchesAgentScope =
        (args.agentSlug === undefined && row.agentSlug === undefined) ||
        row.agentSlug === args.agentSlug;

      if (matchesAgentScope) {
        await ctx.db.delete(row._id);
      }
    }

    for (const item of args.items) {
      await ctx.db.insert("newsContexts", {
        ...(args.agentSlug ? { agentSlug: args.agentSlug } : {}),
        marketSymbol: args.marketSymbol,
        headline: item.headline,
        state: item.state,
        sourceLabel: item.sourceLabel,
        publishedAtLabel: item.publishedAtLabel,
        note: item.note,
        rationale: args.overallReason,
        ...(item.url ? { url: item.url } : {}),
      });
    }

    return args.items[0]?.state ?? "neutral";
  },
});

export const syncAgentRuntimeState = internalMutation({
  args: {
    agentSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_slug", (q) => q.eq("slug", args.agentSlug))
      .unique();

    if (!agent) {
      return null;
    }

    const [tradeIdeas, positions, tradeEvents] = await Promise.all([
      ctx.db
        .query("tradeIdeas")
        .withIndex("by_agentSlug", (q) => q.eq("agentSlug", args.agentSlug))
        .collect(),
      ctx.db
        .query("positions")
        .withIndex("by_agentSlug", (q) => q.eq("agentSlug", args.agentSlug))
        .collect(),
      ctx.db
        .query("tradeEvents")
        .withIndex("by_agentSlug", (q) => q.eq("agentSlug", args.agentSlug))
        .collect(),
    ]);

    const latestTradeIdeas = latestByKey(
      tradeIdeas,
      (row) => `${row.agentSlug}:${row.marketSymbol}`,
      (row) => row._creationTime,
    );
    const latestPositions = latestByKey(
      positions,
      (row) => `${row.agentSlug}:${row.marketSymbol}`,
      (row) => row._creationTime,
    );
    const latestEvent =
      [...tradeEvents].sort((a, b) => b._creationTime - a._creationTime)[0] ?? null;

    const openPositions = latestPositions.length;
    const pnlPercent = Number(
      (
        latestPositions.reduce((sum, position) => sum + position.pnlPercent, 0) /
        Math.max(1, latestPositions.length)
      ).toFixed(2),
    );
    const tradeIdeaStatuses = latestTradeIdeas.map((idea) => idea.status);
    const status = deriveAgentStatus({
      openPositions,
      tradeIdeaStatuses,
    });
    const score = deriveArenaScore({
      pnlPercent,
      openPositions,
      tradeIdeaStatuses,
    });
    const lastAction = latestEvent
      ? `${latestEvent.title}. ${latestEvent.detail}`
      : "Awaiting first persisted scan output.";

    await ctx.db.patch(agent._id, {
      status,
      openPositions,
      pnlPercent,
      score,
      lastAction,
    });

    await ctx.db.insert("leaderboardSnapshots", {
      season: "S0",
      agentSlug: args.agentSlug,
      score,
      pnlPercent,
      openPositions,
      capturedAt: Date.now(),
    });

    return {
      agentSlug: args.agentSlug,
      status,
      openPositions,
      pnlPercent,
      score,
      lastAction,
    };
  },
});

export const purgeEngineDerivedState = internalMutation({
  args: {},
  handler: async (ctx) => {
    const [
      tradeIdeas,
      watchlistItems,
      positions,
      tradeEvents,
      visualTraces,
      leaderboardSnapshots,
      agents,
    ] = await Promise.all([
      ctx.db.query("tradeIdeas").collect(),
      ctx.db.query("watchlistItems").collect(),
      ctx.db.query("positions").collect(),
      ctx.db.query("tradeEvents").collect(),
      ctx.db.query("visualTraces").collect(),
      ctx.db.query("leaderboardSnapshots").collect(),
      ctx.db.query("agents").collect(),
    ]);

    let deleted = 0;

    for (const row of tradeIdeas) {
      if (row.source === "engine") {
        await ctx.db.delete(row._id);
        deleted += 1;
      }
    }

    for (const row of watchlistItems) {
      if (row.source === "engine") {
        await ctx.db.delete(row._id);
        deleted += 1;
      }
    }

    for (const row of positions) {
      if (row.source === "engine") {
        await ctx.db.delete(row._id);
        deleted += 1;
      }
    }

    for (const row of tradeEvents) {
      if (row.source === "engine") {
        await ctx.db.delete(row._id);
        deleted += 1;
      }
    }

    for (const row of visualTraces) {
      if (row.source === "engine") {
        await ctx.db.delete(row._id);
        deleted += 1;
      }
    }

    for (const row of leaderboardSnapshots) {
      await ctx.db.delete(row._id);
      deleted += 1;
    }

    for (const agent of agents) {
      await ctx.db.patch(agent._id, {
        status: "scanning",
        pnlPercent: 0,
        openPositions: 0,
        score: 1000,
        lastAction: "Engine state purged. Awaiting next scan output.",
      });
    }

    return {
      ok: true,
      deleted,
      agentsReset: agents.length,
      purgedAt: Date.now(),
    };
  },
});

export const runArenaScanCycle = internalAction({
  args: {},
  handler: async (ctx) => {
    const startedAt = Date.now();
    const activeAgents = await ctx.runQuery(internal.arena.listActiveAgents, {});
    const newsByMarket = new Map<
      string,
      {
        overallState: "supportive" | "neutral" | "risk";
        overallReason: string;
        items: Array<{
          headline: string;
          state: "supportive" | "neutral" | "risk";
          sourceLabel: string;
          publishedAtLabel: string;
          note: string;
          url?: string;
        }>;
      }
    >();

    for (const agent of activeAgents as any[]) {
      const trackedMarkets = (agent.trackedMarkets ?? [agent.primaryMarket]) as string[];

      for (const marketSymbol of trackedMarkets) {
        const runStartedAt = Date.now();

        try {
          const candles = await fetchPythHistory(marketSymbol, agent.timeframe);
          if (!newsByMarket.has(marketSymbol)) {
            const newsPayload = await fetchMarketNews(marketSymbol);
            const calendarPayload = await fetchMarketCalendar(marketSymbol);
            const mergedConfluence = mergeMarketConfluence({
              news: {
                overallState: newsPayload.overallState,
                overallReason: newsPayload.overallReason,
                items: newsPayload.items.map((item) => ({
                  headline: item.headline,
                  state: item.state,
                  sourceLabel: item.sourceLabel,
                  publishedAtLabel: item.publishedAtLabel,
                  note: item.note,
                  url: item.url,
                })),
              },
              calendar: {
                overallState: calendarPayload.overallState,
                overallReason: calendarPayload.overallReason,
                items: calendarPayload.items.map((item) => ({
                  headline: item.headline,
                  state: item.state,
                  sourceLabel: item.sourceLabel,
                  publishedAtLabel: item.publishedAtLabel,
                  note: item.note,
                  url: item.url,
                })),
              },
            });

            newsByMarket.set(marketSymbol, {
              overallState: mergedConfluence.overallState,
              overallReason: mergedConfluence.overallReason,
              items: mergedConfluence.items,
            });

            if (mergedConfluence.items.length) {
              await ctx.runMutation(internal.arena.persistNewsContexts, {
                marketSymbol,
                overallReason: mergedConfluence.overallReason,
                items: mergedConfluence.items,
              });
            }
          }

          const marketNewsState =
            newsByMarket.get(marketSymbol)?.overallState ?? "neutral";

          if (!candles?.length) {
            await ctx.runMutation(internal.arena.recordScanRun, {
              agentSlug: agent.slug,
              marketSymbol,
              timeframe: agent.timeframe,
              result: "error",
              source: "convex-cron",
              startedAt: runStartedAt,
              finishedAt: Date.now(),
              note: "No candle payload returned from Pyth history.",
              error: "pyth_history_empty",
            });
            continue;
          }

          const latestCandle = candles[candles.length - 1];
          const previousCandle = candles[candles.length - 2] ?? latestCandle;
          const windowHigh = Math.max(...candles.map((candle) => candle.high));
          const windowLow = Math.min(...candles.map((candle) => candle.low));
          const changePercent =
            previousCandle.close === 0
              ? 0
              : Number(
                  (
                    ((latestCandle.close - previousCandle.close) /
                      previousCandle.close) *
                    100
                  ).toFixed(2),
                );

          await ctx.runMutation(internal.arena.updateMarketSnapshot, {
            symbol: marketSymbol,
            price: Number(formatMarketValue(marketSymbol, latestCandle.close)),
            changePercent,
            dailyRange: `${formatMarketValue(marketSymbol, windowLow)} - ${formatMarketValue(
              marketSymbol,
              windowHigh,
            )}`,
            sessionBias: deriveSessionBias(
              latestCandle.close,
              previousCandle.close,
            ),
            source: "pyth",
            lastUpdatedAt: Date.now(),
            newsState: marketNewsState,
            newsRationale:
              newsByMarket.get(marketSymbol)?.overallReason ??
              "No current market-wide news rationale is available.",
            newsUpdatedAt: Date.now(),
          });

          if (agent.slug === "fibonacci-trend") {
            const derived = deriveFibonacciArenaState({
              agentId: agent.slug,
              marketSymbol,
              timeframe: agent.timeframe,
              candles,
              newsState: marketNewsState,
            });

            if (derived) {
              await ctx.runMutation(internal.arena.persistFibonacciDerivedState, {
                agentSlug: agent.slug,
                marketSymbol,
                tradeIdea: derived.tradeIdea,
                watchlistItem: derived.watchlistItem,
                trace: derived.trace,
                events: derived.events,
                position: derived.position,
              });
            }
          }

          if (agent.slug === "third-touch") {
            const derived = deriveThirdTouchArenaState({
              agentId: agent.slug,
              marketSymbol,
              timeframe: agent.timeframe,
              candles,
              newsState: marketNewsState,
            });

            if (derived) {
              await ctx.runMutation(internal.arena.persistFibonacciDerivedState, {
                agentSlug: agent.slug,
                marketSymbol,
                tradeIdea: derived.tradeIdea,
                watchlistItem: derived.watchlistItem,
                trace: derived.trace,
                events: derived.events,
                position: derived.position,
              });
            }
          }

          await ctx.runMutation(internal.arena.syncAgentRuntimeState, {
            agentSlug: agent.slug,
          });

          await ctx.runMutation(internal.arena.recordScanRun, {
            agentSlug: agent.slug,
            marketSymbol,
            timeframe: agent.timeframe,
            result: "success",
            source: "convex-cron",
            startedAt: runStartedAt,
            finishedAt: Date.now(),
            note: `Fetched ${candles.length} candles.`,
            error: undefined,
          });
        } catch (error) {
          await ctx.runMutation(internal.arena.recordScanRun, {
            agentSlug: agent.slug,
            marketSymbol,
            timeframe: agent.timeframe,
            result: "error",
            source: "convex-cron",
            startedAt: runStartedAt,
            finishedAt: Date.now(),
            note: undefined,
            error: error instanceof Error ? error.message : "scan_failed",
          });
        }
      }
    }

    return {
      ok: true,
      startedAt,
      finishedAt: Date.now(),
    };
  },
});

export const runArenaScanCycleNow = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ ok: boolean; startedAt: number; finishedAt: number }> => {
    return (await ctx.runAction(internal.arena.runArenaScanCycle, {})) as {
      ok: boolean;
      startedAt: number;
      finishedAt: number;
    };
  },
});

export const purgeEngineDerivedStateNow = action({
  args: {},
  handler: async (ctx): Promise<{
    ok: boolean;
    deleted: number;
    agentsReset: number;
    purgedAt: number;
  }> => {
    return await ctx.runMutation(internal.arena.purgeEngineDerivedState, {});
  },
});

export const startBrowserReviewSession = action({
  args: {
    agentSlug: v.string(),
    marketSymbol: v.string(),
    timeframe: v.union(v.literal("15m"), v.literal("1h"), v.literal("4h")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    ok: boolean;
    sessionId: Id<"browserSessions">;
    browserTargetSymbol: string;
    browserTargetTimeframe: string;
  }> => {
    const reviewTarget = resolveBrowserReviewTarget({
      marketSymbol: args.marketSymbol,
      timeframe: args.timeframe,
    });
    const sessionId: Id<"browserSessions"> = await ctx.runMutation(
      internal.arena.createBrowserSession,
      {
      agentSlug: args.agentSlug,
      marketSymbol: args.marketSymbol,
      timeframe: args.timeframe,
      browserTargetSymbol: reviewTarget.browserTargetSymbol,
      browserTargetTimeframe: reviewTarget.browserTargetTimeframe,
      inspectedOn: "deriv",
      targetUrl: "https://charts.deriv.com/deriv",
      totalSteps: 4,
      currentStepLabel: "Starting remote browser session",
      },
    );

    const steps = [
      {
        status: "loading_chart" as const,
        label: "Open Deriv chart",
        detail: "Load the Deriv TradingView chart surface in the remote session.",
      },
      {
        status: "switching_symbol" as const,
        label: `Switch symbol to ${reviewTarget.browserTargetSymbol}`,
        detail: reviewTarget.reason,
      },
      {
        status: "switching_timeframe" as const,
        label: `Switch timeframe to ${reviewTarget.browserTargetTimeframe}`,
        detail: `Set the working chart interval to ${reviewTarget.browserTargetTimeframe}.`,
      },
      {
        status: "ready" as const,
        label: "Hold chart for review",
        detail:
          "Keep the live session open on the target market so the browser agent can inspect structure.",
      },
    ];

    await ctx.runMutation(internal.arena.upsertBrowserSessionEvents, {
      sessionId,
      events: steps.map((step, index) => ({
        sequence: index + 1,
        label: step.label,
        detail: step.detail,
        status: (index === 0 ? "running" : "queued") as BrowserEventStatus,
      })),
    });

    for (const [index, step] of steps.entries()) {
      await ctx.runMutation(internal.arena.setBrowserSessionState, {
        sessionId,
        status: step.status,
        currentStepLabel: step.label,
        currentStepIndex: index + 1,
        completedAt: step.status === "ready" ? Date.now() : undefined,
        error: undefined,
      });

      await ctx.runMutation(internal.arena.upsertBrowserSessionEvents, {
        sessionId,
        events: steps.map((entry, entryIndex) => ({
          sequence: entryIndex + 1,
          label: entry.label,
          detail: entry.detail,
          status: (
            entryIndex < index
              ? "completed"
              : entryIndex === index
                ? step.status === "ready"
                  ? "completed"
                  : "running"
                : "queued"
          ) as BrowserEventStatus,
        })),
      });

      if (step.status !== "ready") {
        await sleep(900);
      }
    }

    return {
      ok: true,
      sessionId,
      browserTargetSymbol: reviewTarget.browserTargetSymbol,
      browserTargetTimeframe: reviewTarget.browserTargetTimeframe,
    };
  },
});

export const persistVisionDecision = mutation({
  args: {
    agentSlug: v.string(),
    marketSymbol: v.string(),
    regime: v.union(v.literal("bullish"), v.literal("bearish"), v.literal("mixed")),
    verdict: v.union(v.literal("valid"), v.literal("staged"), v.literal("invalid"), v.literal("reject")),
    direction: v.union(v.literal("long"), v.literal("short"), v.literal("none")),
    confidence: v.number(),
    correctedT1: v.optional(v.object({ price: v.number(), note: v.string() })),
    correctedT2: v.optional(v.object({ price: v.number(), note: v.string() })),
    correctedZone: v.optional(v.object({ low: v.number(), high: v.number(), projectedPrice: v.number() })),
    rationale: v.string(),
    issues: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("visionDecisions")
      .withIndex("by_agentSlug_marketSymbol", (q) =>
        q.eq("agentSlug", args.agentSlug).eq("marketSymbol", args.marketSymbol),
      )
      .unique();

    // Only update when something structurally significant changed
    const significantChange =
      !existing ||
      existing.regime !== args.regime ||
      existing.direction !== args.direction ||
      existing.verdict !== args.verdict ||
      (args.correctedT1 != null &&
        existing.correctedT1 != null &&
        Math.abs(args.correctedT1.price - existing.correctedT1.price) /
          Math.max(existing.correctedT1.price, 1) > 0.02) ||
      (args.correctedT2 != null &&
        existing.correctedT2 != null &&
        Math.abs(args.correctedT2.price - existing.correctedT2.price) /
          Math.max(existing.correctedT2.price, 1) > 0.02);

    if (!significantChange) {
      return { updated: false, id: existing!._id };
    }

    const payload = { ...args, capturedAt: Date.now() };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return { updated: true, id: existing._id };
    }

    const id = await ctx.db.insert("visionDecisions", payload);
    return { updated: true, id };
  },
});

export const updateAgentDisplayNames = mutation({
  args: {},
  handler: async (ctx) => {
    const nameMap: Record<string, { name: string; strategyLabel: string }> = {
      "fibonacci-trend": { name: "Auron", strategyLabel: "Fibonacci trend continuation" },
      "third-touch": { name: "Kairos", strategyLabel: "Third touch trendline" },
    };

    let updated = 0;
    for (const [slug, display] of Object.entries(nameMap)) {
      const agent = await ctx.db
        .query("agents")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .unique();
      if (agent) {
        await ctx.db.patch(agent._id, display);
        updated += 1;
      }
    }
    return { updated };
  },
});

export const crons = cronJobs();
crons.interval("arena scan cycle", { minutes: 5 }, internal.arena.runArenaScanCycle);

export default crons;
