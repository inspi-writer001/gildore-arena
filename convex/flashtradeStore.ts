import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";

const ACTIVE_EXECUTION_STATUSES = new Set([
  "pending_funding",
  "funding_confirmed",
  "open_submitted",
  "open",
  "close_submitted",
]);

const executionStatusValidator = v.union(
  v.literal("pending_funding"),
  v.literal("funding_confirmed"),
  v.literal("open_submitted"),
  v.literal("open"),
  v.literal("close_submitted"),
  v.literal("closed_pending_settlement"),
  v.literal("closed"),
  v.literal("failed"),
);

const settlementStatusValidator = v.union(
  v.literal("not_started"),
  v.literal("pending"),
  v.literal("blocked_program_constraint"),
  v.literal("settled"),
);

function normalizeAgentLookupValue(value: string) {
  return value.trim().toLowerCase();
}

export const getExecutionWalletState = query({
  args: {
    walletAddress: v.string(),
  },
  handler: async (ctx, args) => {
    const wallet = await ctx.db
      .query("executionWallets")
      .withIndex("by_userWalletAddress", (queryBuilder) =>
        queryBuilder.eq("userWalletAddress", args.walletAddress),
      )
      .first();

    if (!wallet) {
      return null;
    }

    return {
      chain: wallet.chain,
      executionWalletAddress: wallet.executionWalletAddress,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
      lastUsedAt: wallet.lastUsedAt ?? null,
    };
  },
});

export const listExecutions = query({
  args: {
    walletAddress: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("flashtradeExecutions")
      .withIndex("by_userWalletAddress", (queryBuilder) =>
        queryBuilder.eq("userWalletAddress", args.walletAddress),
      )
      .collect();
  },
});

export const resolveExecutionContext = internalQuery({
  args: {
    walletAddress: v.string(),
    agentName: v.string(),
    marketSymbol: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const normalizedAgentName = normalizeAgentLookupValue(args.agentName);
    const agentBySlug = await ctx.db
      .query("agents")
      .withIndex("by_slug", (queryBuilder) =>
        queryBuilder.eq("slug", normalizedAgentName),
      )
      .first();
    const agentByName = agentBySlug
      ? null
      : (await ctx.db.query("agents").collect()).find(
          (candidate) =>
            normalizeAgentLookupValue(candidate.name) === normalizedAgentName,
        ) ?? null;
    const agent = agentBySlug ?? agentByName;

    const agentSlug = agent?.slug ?? normalizedAgentName;
    const wallet = await ctx.db
      .query("executionWallets")
      .withIndex("by_userWalletAddress", (queryBuilder) =>
        queryBuilder.eq("userWalletAddress", args.walletAddress),
      )
      .first();
    const executions = await ctx.db
      .query("flashtradeExecutions")
      .withIndex("by_userWalletAddress_agentSlug", (queryBuilder) =>
        queryBuilder
          .eq("userWalletAddress", args.walletAddress)
          .eq("agentSlug", agentSlug),
      )
      .collect();
    const activeExecution =
      executions
        .filter((execution) => ACTIVE_EXECUTION_STATUSES.has(execution.status))
        .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null;

    let setup = null;
    const marketSymbol = args.marketSymbol;
    if (marketSymbol) {
      const setups = await ctx.db
        .query("strategySetups")
        .withIndex("by_agentSlug_marketSymbol_isActive", (queryBuilder) =>
          queryBuilder
            .eq("agentSlug", agentSlug)
            .eq("marketSymbol", marketSymbol)
            .eq("isActive", true),
        )
        .collect();
      setup =
        setups.sort(
          (left, right) => right.lastReviewedAt - left.lastReviewedAt,
        )[0] ?? null;
    }

    return {
      agent,
      agentSlug,
      wallet,
      activeExecution,
      setup,
    };
  },
});

export const createExecutionWalletRecord = internalMutation({
  args: {
    walletAddress: v.string(),
    executionWalletAddress: v.string(),
    encryptedPrivateKey: v.string(),
    encryptionSalt: v.string(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("executionWallets")
      .withIndex("by_userWalletAddress", (queryBuilder) =>
        queryBuilder.eq("userWalletAddress", args.walletAddress),
      )
      .first();

    if (existing) {
      return existing;
    }

    const identifier = await ctx.db.insert("executionWallets", {
      chain: "solana",
      userWalletAddress: args.walletAddress,
      executionWalletAddress: args.executionWalletAddress,
      encryptedPrivateKey: args.encryptedPrivateKey,
      encryptionSalt: args.encryptionSalt,
      createdAt: args.createdAt,
      updatedAt: args.createdAt,
      lastUsedAt: args.createdAt,
    });

    return await ctx.db.get(identifier);
  },
});

export const touchExecutionWalletRecord = internalMutation({
  args: {
    walletAddress: v.string(),
    lastUsedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("executionWallets")
      .withIndex("by_userWalletAddress", (queryBuilder) =>
        queryBuilder.eq("userWalletAddress", args.walletAddress),
      )
      .first();

    if (!existing) {
      return null;
    }

    await ctx.db.patch(existing._id, {
      updatedAt: args.lastUsedAt,
      lastUsedAt: args.lastUsedAt,
    });
    return await ctx.db.get(existing._id);
  },
});

export const createExecutionRecord = internalMutation({
  args: {
    walletAddress: v.string(),
    agentSlug: v.string(),
    agentName: v.string(),
    marketSymbol: v.string(),
    venueMarketSymbol: v.string(),
    executionWalletAddress: v.string(),
    direction: v.union(v.literal("long"), v.literal("short")),
    principalAmountUi: v.string(),
    principalAmountBaseUnits: v.string(),
    leverage: v.number(),
    entryPrice: v.number(),
    stopLoss: v.number(),
    takeProfit: v.number(),
    slippagePercentage: v.string(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    const identifier = await ctx.db.insert("flashtradeExecutions", {
      userWalletAddress: args.walletAddress,
      agentSlug: args.agentSlug,
      agentName: args.agentName,
      marketSymbol: args.marketSymbol,
      venueMarketSymbol: args.venueMarketSymbol,
      venue: "flashtrade",
      executionWalletAddress: args.executionWalletAddress,
      direction: args.direction,
      principalAmountUi: args.principalAmountUi,
      principalAmountBaseUnits: args.principalAmountBaseUnits,
      leverage: args.leverage,
      riskRewardRatio: 3,
      entryPrice: args.entryPrice,
      stopLoss: args.stopLoss,
      takeProfit: args.takeProfit,
      slippagePercentage: args.slippagePercentage,
      retryCount: 0,
      settlementStatus: "not_started",
      status: "pending_funding",
      createdAt: args.createdAt,
      updatedAt: args.createdAt,
    });

    return await ctx.db.get(identifier);
  },
});

export const patchExecutionRecord = internalMutation({
  args: {
    executionId: v.id("flashtradeExecutions"),
    status: v.optional(executionStatusValidator),
    settlementStatus: v.optional(settlementStatusValidator),
    preview: v.optional(
      v.object({
        newEntryPrice: v.optional(v.string()),
        newLeverage: v.optional(v.string()),
        newLiquidationPrice: v.optional(v.string()),
        availableLiquidity: v.optional(v.string()),
        youPayUsdUi: v.optional(v.string()),
        youRecieveUsdUi: v.optional(v.string()),
        entryFee: v.optional(v.string()),
        marginFeePercentage: v.optional(v.string()),
      }),
    ),
    positionSnapshot: v.optional(
      v.object({
        sizeUsdUi: v.optional(v.string()),
        collateralUsdUi: v.optional(v.string()),
        pnlWithFeeUsdUi: v.optional(v.string()),
        pnlPercentageWithFee: v.optional(v.string()),
        leverageUi: v.optional(v.string()),
        liquidationPriceUi: v.optional(v.string()),
      }),
    ),
    venuePositionKey: v.optional(v.string()),
    venueOpenSignature: v.optional(v.string()),
    venueCloseSignature: v.optional(v.string()),
    vaultConsumeSignature: v.optional(v.string()),
    vaultCloseSignature: v.optional(v.string()),
    returnedAmountUi: v.optional(v.string()),
    realizedPnlUi: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    retryCountDelta: v.optional(v.number()),
    openedAt: v.optional(v.number()),
    closedAt: v.optional(v.number()),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.executionId);
    if (!existing) {
      throw new Error("Execution record not found.");
    }

    await ctx.db.patch(args.executionId, {
      ...(args.status ? { status: args.status } : {}),
      ...(args.settlementStatus
        ? { settlementStatus: args.settlementStatus }
        : {}),
      ...(args.preview ? { preview: args.preview } : {}),
      ...(args.positionSnapshot
        ? { positionSnapshot: args.positionSnapshot }
        : {}),
      ...(args.venuePositionKey ? { venuePositionKey: args.venuePositionKey } : {}),
      ...(args.venueOpenSignature
        ? { venueOpenSignature: args.venueOpenSignature }
        : {}),
      ...(args.venueCloseSignature
        ? { venueCloseSignature: args.venueCloseSignature }
        : {}),
      ...(args.vaultConsumeSignature
        ? { vaultConsumeSignature: args.vaultConsumeSignature }
        : {}),
      ...(args.vaultCloseSignature
        ? { vaultCloseSignature: args.vaultCloseSignature }
        : {}),
      ...(args.returnedAmountUi
        ? { returnedAmountUi: args.returnedAmountUi }
        : {}),
      ...(args.realizedPnlUi ? { realizedPnlUi: args.realizedPnlUi } : {}),
      ...(typeof args.failureReason === "string"
        ? { failureReason: args.failureReason }
        : {}),
      ...(args.openedAt ? { openedAt: args.openedAt } : {}),
      ...(args.closedAt ? { closedAt: args.closedAt } : {}),
      retryCount: existing.retryCount + (args.retryCountDelta ?? 0),
      updatedAt: args.updatedAt,
    });

    return await ctx.db.get(args.executionId);
  },
});
