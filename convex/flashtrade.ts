"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, type ActionCtx } from "./_generated/server";
import {
  buildFlashTradeClosePosition,
  buildFlashTradeOpenPosition,
  listFlashTradePositions,
  type FlashTradePosition,
} from "../lib/flashtrade/client";
import {
  decryptExecutionWalletSecret,
  encryptExecutionWalletSecret,
} from "../lib/server/execution-wallet-crypto";
import {
  assertExecutionWalletHasGas,
  createExecutionWalletSeed,
  createExecutionWalletSignerFromSeed,
  createRpc,
  ensureExecutionWalletFundingAta,
  signAndBroadcastVenueTransaction,
} from "../lib/solana/execution-wallet";
import { fetchUserVaultSnapshot } from "../lib/solana/gildore-vault";
import {
  executeServerConsumeTicker,
  executeServerUpdateTickerCloseTrade,
} from "../lib/solana/server-gildore-vault";

const SUPPORTED_FLASHTRADE_MARKETS = {
  "XAU/USD": "XAU",
  "XAG/USD": "XAG",
  "EUR/USD": "EUR",
  "GBP/USD": "GBP",
} as const;

const CLOSED_EXECUTION_STATUSES = new Set([
  "closed",
  "closed_pending_settlement",
  "failed",
]);

function getVenueMarketSymbol(marketSymbol: string) {
  return SUPPORTED_FLASHTRADE_MARKETS[
    marketSymbol as keyof typeof SUPPORTED_FLASHTRADE_MARKETS
  ] ?? null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDevnetRpc() {
  const rpcUrl =
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
    "https://api.devnet.solana.com";
  return rpcUrl.includes("devnet");
}

function formatUiAmountFromBaseUnits(value: bigint, decimals: number) {
  const scale = BigInt(10) ** BigInt(decimals);
  const whole = value / scale;
  const fraction = value % scale;
  const fractionText = fraction
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return fractionText.length > 0
    ? `${whole.toString()}.${fractionText}`
    : whole.toString();
}

function computeExpectedPrincipal(args: {
  vaultBalance: bigint;
  amountToSpend: bigint;
  decimals: number;
}) {
  const minimumSpendable = BigInt(15) * BigInt(10) ** BigInt(args.decimals);
  const hardCapSpendable = BigInt(30) * BigInt(10) ** BigInt(args.decimals);

  if (args.vaultBalance < minimumSpendable) {
    throw new Error("Vault balance is below the minimum spendable threshold.");
  }

  if (args.amountToSpend > BigInt(0)) {
    return args.amountToSpend;
  }

  return args.vaultBalance >= hardCapSpendable
    ? hardCapSpendable
    : args.vaultBalance;
}

function computeRiskModel(args: {
  direction: "long" | "short";
  entryPrice: number;
  stopLoss: number;
}) {
  const riskDistance =
    args.direction === "long"
      ? args.entryPrice - args.stopLoss
      : args.stopLoss - args.entryPrice;

  if (riskDistance <= 0) {
    throw new Error("Stop loss must be on the invalidation side of the entry.");
  }

  const takeProfit =
    args.direction === "long"
      ? args.entryPrice + riskDistance * 3
      : args.entryPrice - riskDistance * 3;
  const leverage = Number((args.entryPrice / riskDistance).toFixed(4));

  if (!Number.isFinite(leverage) || leverage <= 0) {
    throw new Error("Derived leverage is invalid for this setup.");
  }

  return {
    leverage,
    takeProfit: Number(takeProfit.toFixed(8)),
  };
}

function toPositionSnapshot(position: FlashTradePosition | null) {
  if (!position) {
    return undefined;
  }

  return {
    sizeUsdUi: position.sizeUsdUi,
    collateralUsdUi: position.collateralUsdUi,
    pnlWithFeeUsdUi: position.pnlWithFeeUsdUi,
    pnlPercentageWithFee: position.pnlPercentageWithFee,
    leverageUi: position.leverageUi,
    liquidationPriceUi: position.liquidationPriceUi,
  };
}

type StoredExecutionWallet = {
  executionWalletAddress: string;
  encryptedPrivateKey: string;
  encryptionSalt: string;
};

type ResolvedExecutionContext = {
  wallet: StoredExecutionWallet | null;
  activeExecution: {
    _id: Id<"flashtradeExecutions">;
    status: string;
    slippagePercentage: string;
    venuePositionKey?: string;
    venueMarketSymbol: string;
    direction: "long" | "short";
  } | null;
  agent: { name: string } | null;
  agentSlug: string;
  setup: {
    direction: "long" | "short" | "none";
    entryPrice?: number;
    stopPrice?: number;
  } | null;
};

type EnsureExecutionWalletArgs = {
  privyUserId: string;
  ecosystem: "solana" | "celo";
  solanaWalletAddress?: string;
  evmWalletAddress?: string;
  celoWalletAddress?: string;
};

type OpenFlashTradeExecutionArgs = {
  privyUserId: string;
  walletAddress: string;
  agentName: string;
  marketSymbol: string;
  direction?: "long" | "short";
  entryPrice?: number;
  stopLoss?: number;
  slippagePercentage?: string;
  originEcosystem: "solana" | "celo";
  isManualTest?: boolean;
  testEnvironment?: "devnet";
};

async function findOpenedPosition(args: {
  owner: string;
  venueMarketSymbol: string;
  direction: "long" | "short";
  beforePositionKeys: Set<string>;
}) {
  const desiredSide = args.direction === "long" ? "long" : "short";

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const positions = await listFlashTradePositions(args.owner);
    const match =
      positions.find(
        (position) =>
          position.marketSymbol === args.venueMarketSymbol &&
          position.sideUi?.toLowerCase() === desiredSide &&
          !args.beforePositionKeys.has(position.key),
      ) ??
      positions.find(
        (position) =>
          position.marketSymbol === args.venueMarketSymbol &&
          position.sideUi?.toLowerCase() === desiredSide,
      );

    if (match) {
      return match;
    }

    await sleep(1_000);
  }

  return null;
}

async function ensureExecutionWalletRecord(
  ctx: ActionCtx,
  args: EnsureExecutionWalletArgs,
) {
  const existing = (await ctx.runQuery(
    internal.flashtradeStore.resolveExecutionContext,
    {
      privyUserId: args.privyUserId,
      agentName: "",
    },
  )) as ResolvedExecutionContext;

  if (existing.wallet) {
    await ctx.runMutation(internal.flashtradeStore.createExecutionWalletRecord, {
      privyUserId: args.privyUserId,
      userWalletAddress:
        args.solanaWalletAddress ??
        args.celoWalletAddress ??
        args.evmWalletAddress,
      solanaWalletAddress: args.solanaWalletAddress,
      evmWalletAddress: args.evmWalletAddress,
      celoWalletAddress: args.celoWalletAddress,
      executionWalletAddress: existing.wallet.executionWalletAddress,
      encryptedPrivateKey: existing.wallet.encryptedPrivateKey,
      encryptionSalt: existing.wallet.encryptionSalt,
      createdAt: Date.now(),
    });

    return {
      executionWalletAddress: existing.wallet.executionWalletAddress,
      created: false,
    };
  }

  const seed = createExecutionWalletSeed();
  const signer = await createExecutionWalletSignerFromSeed(seed);
  const encrypted = encryptExecutionWalletSecret(seed);
  const createdAt = Date.now();
  const record = (await ctx.runMutation(
    internal.flashtradeStore.createExecutionWalletRecord,
    {
      privyUserId: args.privyUserId,
      userWalletAddress:
        args.solanaWalletAddress ??
        args.celoWalletAddress ??
        args.evmWalletAddress,
      solanaWalletAddress: args.solanaWalletAddress,
      evmWalletAddress: args.evmWalletAddress,
      celoWalletAddress: args.celoWalletAddress,
      executionWalletAddress: signer.address,
      encryptedPrivateKey: encrypted.encryptedPrivateKey,
      encryptionSalt: encrypted.encryptionSalt,
      createdAt,
    },
  )) as StoredExecutionWallet | null;

  if (!record) {
    throw new Error("Failed to create execution wallet record.");
  }

  return {
    executionWalletAddress: record.executionWalletAddress,
    created: true,
  };
}

async function openFlashTradeExecution(
  ctx: ActionCtx,
  args: OpenFlashTradeExecutionArgs,
) {
  const venueMarketSymbol = getVenueMarketSymbol(args.marketSymbol);
  if (!venueMarketSymbol) {
    throw new Error(
      `${args.marketSymbol} is not supported on FlashTrade v1. VIX and unsupported pairs stay on the deferred execution path.`,
    );
  }

  const ensuredWallet = await ensureExecutionWalletRecord(ctx, {
    privyUserId: args.privyUserId,
    ecosystem: args.originEcosystem,
    solanaWalletAddress:
      args.originEcosystem === "solana" ? args.walletAddress : undefined,
    celoWalletAddress:
      args.originEcosystem === "celo" ? args.walletAddress : undefined,
  });

  const context = (await ctx.runQuery(
    internal.flashtradeStore.resolveExecutionContext,
    {
      privyUserId: args.privyUserId,
      agentName: args.agentName,
      marketSymbol: args.marketSymbol,
    },
  )) as ResolvedExecutionContext;

  if (!context.wallet) {
    throw new Error("Execution wallet record is missing after creation.");
  }
  if (context.activeExecution) {
    return {
      reusedExecution: true,
      execution: context.activeExecution,
    };
  }

  const direction = args.direction ?? context.setup?.direction;
  const entryPrice = args.entryPrice ?? context.setup?.entryPrice;
  const stopLoss = args.stopLoss ?? context.setup?.stopPrice;

  if (direction !== "long" && direction !== "short") {
    throw new Error("Execution direction is missing for this setup.");
  }
  if (typeof entryPrice !== "number" || typeof stopLoss !== "number") {
    throw new Error("Entry and stop loss must be present before execution.");
  }

  const { leverage, takeProfit } = computeRiskModel({
    direction,
    entryPrice,
    stopLoss,
  });
  const slippagePercentage = args.slippagePercentage?.trim() || "0.5";
  const vaultSnapshot = await fetchUserVaultSnapshot(
    createRpc(),
    args.walletAddress,
    args.agentName,
  );

  if (!vaultSnapshot.userState || !vaultSnapshot.ticker) {
    throw new Error(
      "Vault state is incomplete. Fund the agent and register a spend amount before execution.",
    );
  }
  if (vaultSnapshot.ticker.isInPosition) {
    throw new Error("This agent is already marked as in position.");
  }

  const principalBaseUnits = computeExpectedPrincipal({
    vaultBalance: vaultSnapshot.userState.amount,
    amountToSpend: vaultSnapshot.ticker.amountToSpend,
    decimals: vaultSnapshot.decimals,
  });
  const principalAmountUi = formatUiAmountFromBaseUnits(
    principalBaseUnits,
    vaultSnapshot.decimals,
  );

  const executionRecord = (await ctx.runMutation(
    internal.flashtradeStore.createExecutionRecord,
    {
      privyUserId: args.privyUserId,
      walletAddress: args.walletAddress,
      originWalletAddress: args.walletAddress,
      originEcosystem: args.originEcosystem,
      agentSlug: context.agentSlug,
      agentName: context.agent?.name ?? args.agentName.trim(),
      marketSymbol: args.marketSymbol,
      venueMarketSymbol,
      executionWalletAddress: context.wallet.executionWalletAddress,
      direction,
      principalAmountUi,
      principalAmountBaseUnits: principalBaseUnits.toString(),
      leverage,
      entryPrice,
      stopLoss,
      takeProfit,
      slippagePercentage,
      isManualTest: args.isManualTest,
      testEnvironment: args.testEnvironment,
      createdAt: Date.now(),
    },
  )) as { _id: Id<"flashtradeExecutions"> } | null;

  if (!executionRecord) {
    throw new Error("Failed to create execution record.");
  }

  try {
    const decryptedSeed = decryptExecutionWalletSecret({
      encryptedPrivateKey: context.wallet.encryptedPrivateKey,
      encryptionSalt: context.wallet.encryptionSalt,
    });
    const signer = await createExecutionWalletSignerFromSeed(decryptedSeed);
    const ata = await ensureExecutionWalletFundingAta(signer.address);

    await ctx.runMutation(internal.flashtradeStore.patchExecutionRecord, {
      executionId: executionRecord._id,
      status: "funding_confirmed",
      updatedAt: Date.now(),
    });

    const preview = await buildFlashTradeOpenPosition({
      inputTokenSymbol: "USDC",
      outputTokenSymbol: venueMarketSymbol,
      inputAmountUi: principalAmountUi,
      leverage,
      tradeType: direction === "long" ? "LONG" : "SHORT",
      owner: signer.address,
      orderType: "MARKET",
      slippagePercentage,
      takeProfit: takeProfit.toString(),
      stopLoss: stopLoss.toString(),
    });

    if (preview.err) {
      throw new Error(preview.err);
    }
    if (!preview.transactionBase64) {
      throw new Error("FlashTrade did not return a transaction to sign.");
    }

    await ctx.runMutation(internal.flashtradeStore.patchExecutionRecord, {
      executionId: executionRecord._id,
      preview: {
        newEntryPrice: preview.newEntryPrice ?? undefined,
        newLeverage: preview.newLeverage ?? undefined,
        newLiquidationPrice: preview.newLiquidationPrice ?? undefined,
        availableLiquidity: preview.availableLiquidity ?? undefined,
        youPayUsdUi: preview.youPayUsdUi ?? undefined,
        youRecieveUsdUi: preview.youRecieveUsdUi ?? undefined,
        entryFee: preview.entryFee ?? undefined,
        marginFeePercentage: preview.marginFeePercentage ?? undefined,
      },
      updatedAt: Date.now(),
    });

    const existingPositions = await listFlashTradePositions(signer.address);
    const beforePositionKeys = new Set(
      existingPositions.map((position) => position.key),
    );
    const consume = await executeServerConsumeTicker(
      args.walletAddress,
      args.agentName,
      ata.ataAddress,
    );

    await ctx.runMutation(internal.flashtradeStore.patchExecutionRecord, {
      executionId: executionRecord._id,
      status: "open_submitted",
      vaultConsumeSignature: consume.signature,
      updatedAt: Date.now(),
    });

    await assertExecutionWalletHasGas(signer.address);
    const openResult = await signAndBroadcastVenueTransaction({
      transactionBase64: preview.transactionBase64,
      signer,
      logScope: "flashtrade:open-position",
    });
    const openedPosition = await findOpenedPosition({
      owner: signer.address,
      venueMarketSymbol,
      direction,
      beforePositionKeys,
    });

    await ctx.runMutation(internal.flashtradeStore.patchExecutionRecord, {
      executionId: executionRecord._id,
      status: "open",
      venueOpenSignature: openResult.signature,
      venuePositionKey: openedPosition?.key,
      positionSnapshot: toPositionSnapshot(openedPosition),
      openedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.runMutation(internal.flashtradeStore.touchExecutionWalletRecord, {
      privyUserId: args.privyUserId,
      lastUsedAt: Date.now(),
    });

    return {
      reusedExecution: false,
      executionWalletAddress: ensuredWallet.executionWalletAddress,
      principalAmountUi,
      leverage,
      takeProfit,
      fundingTokenAccount: ata.ataAddress,
      executionId: executionRecord._id,
      vaultConsumeSignature: consume.signature,
      venueOpenSignature: openResult.signature,
      venuePositionKey: openedPosition?.key ?? null,
      preview: {
        entryPrice: preview.newEntryPrice ?? null,
        leverage: preview.newLeverage ?? null,
        liquidationPrice: preview.newLiquidationPrice ?? null,
      },
    };
  } catch (error) {
    await ctx.runMutation(internal.flashtradeStore.patchExecutionRecord, {
      executionId: executionRecord._id,
      status: "failed",
      failureReason:
        error instanceof Error
          ? error.message
          : "Unknown FlashTrade execution error.",
      retryCountDelta: 1,
      updatedAt: Date.now(),
    });
    throw error;
  }
}

export const ensureExecutionWallet: ReturnType<typeof action> = action({
  args: {
    privyUserId: v.string(),
    ecosystem: v.union(v.literal("solana"), v.literal("celo")),
    solanaWalletAddress: v.optional(v.string()),
    evmWalletAddress: v.optional(v.string()),
    celoWalletAddress: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    executionWalletAddress: string;
    created: boolean;
  }> => {
    return await ensureExecutionWalletRecord(ctx, args);
  },
});

export const openFlashTradePosition: ReturnType<typeof action> = action({
  args: {
    privyUserId: v.string(),
    walletAddress: v.string(),
    agentName: v.string(),
    marketSymbol: v.string(),
    direction: v.optional(v.union(v.literal("long"), v.literal("short"))),
    entryPrice: v.optional(v.number()),
    stopLoss: v.optional(v.number()),
    slippagePercentage: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<unknown> => {
    return await openFlashTradeExecution(ctx, {
      ...args,
      originEcosystem: "solana",
    });
  },
});

export const runFlashTradeDevnetTest: ReturnType<typeof action> = action({
  args: {
    privyUserId: v.string(),
    walletAddress: v.string(),
    agentName: v.string(),
    marketSymbol: v.string(),
    direction: v.optional(v.union(v.literal("long"), v.literal("short"))),
    entryPrice: v.optional(v.number()),
    stopLoss: v.optional(v.number()),
    slippagePercentage: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<unknown> => {
    if (!isDevnetRpc()) {
      throw new Error(
        "Manual FlashTrade test is restricted to the current Solana devnet environment.",
      );
    }

    return await openFlashTradeExecution(ctx, {
      ...args,
      originEcosystem: "solana",
      isManualTest: true,
      testEnvironment: "devnet",
    });
  },
});

export const closeFlashTradePosition: ReturnType<typeof action> = action({
  args: {
    privyUserId: v.string(),
    walletAddress: v.string(),
    agentName: v.string(),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const context = (await ctx.runQuery(
      internal.flashtradeStore.resolveExecutionContext,
      {
        privyUserId: args.privyUserId,
        agentName: args.agentName,
      },
    )) as ResolvedExecutionContext;

    if (!context.wallet) {
      throw new Error("Execution wallet not found.");
    }
    if (!context.activeExecution) {
      throw new Error("No active FlashTrade execution found for this agent.");
    }

    const execution = context.activeExecution;
    const decryptedSeed = decryptExecutionWalletSecret({
      encryptedPrivateKey: context.wallet.encryptedPrivateKey,
      encryptionSalt: context.wallet.encryptionSalt,
    });
    const signer = await createExecutionWalletSignerFromSeed(decryptedSeed);
    const positions = await listFlashTradePositions(signer.address);
    const activePosition =
      positions.find((position) => position.key === execution.venuePositionKey) ??
      positions.find(
        (position) =>
          position.marketSymbol === execution.venueMarketSymbol &&
          position.sideUi?.toLowerCase() === execution.direction,
      ) ??
      null;

    if (!activePosition) {
      throw new Error("No matching live FlashTrade position found to close.");
    }
    if (!activePosition.sizeUsdUi) {
      throw new Error("FlashTrade position size is missing.");
    }

    await ctx.runMutation(internal.flashtradeStore.patchExecutionRecord, {
      executionId: execution._id,
      status: "close_submitted",
      updatedAt: Date.now(),
    });

    try {
      await assertExecutionWalletHasGas(signer.address);
      const closePreview = await buildFlashTradeClosePosition({
        positionKey: activePosition.key,
        inputUsdUi: activePosition.sizeUsdUi,
        withdrawTokenSymbol: "USDC",
        slippagePercentage: execution.slippagePercentage,
      });

      if (closePreview.err) {
        throw new Error(closePreview.err);
      }
      if (!closePreview.transactionBase64) {
        throw new Error("FlashTrade did not return a close transaction.");
      }

      const closeResult = await signAndBroadcastVenueTransaction({
        transactionBase64: closePreview.transactionBase64,
        signer,
        logScope: "flashtrade:close-position",
      });
      const vaultClose = await executeServerUpdateTickerCloseTrade(
        args.walletAddress,
        args.agentName,
      );

      await ctx.runMutation(internal.flashtradeStore.patchExecutionRecord, {
        executionId: execution._id,
        status: "closed_pending_settlement",
        settlementStatus: "blocked_program_constraint",
        venueCloseSignature: closeResult.signature,
        vaultCloseSignature: vaultClose.signature,
        returnedAmountUi: closePreview.receiveTokenAmountUi ?? undefined,
        realizedPnlUi: closePreview.settledPnl ?? undefined,
        closedAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.runMutation(internal.flashtradeStore.touchExecutionWalletRecord, {
        privyUserId: args.privyUserId,
        lastUsedAt: Date.now(),
      });

      return {
        executionId: execution._id,
        venueCloseSignature: closeResult.signature,
        vaultCloseSignature: vaultClose.signature,
        returnedAmountUi: closePreview.receiveTokenAmountUi ?? null,
        realizedPnlUi: closePreview.settledPnl ?? null,
        settlementStatus: "blocked_program_constraint" as const,
      };
    } catch (error) {
      await ctx.runMutation(internal.flashtradeStore.patchExecutionRecord, {
        executionId: execution._id,
        status: "open",
        failureReason:
          error instanceof Error
            ? error.message
            : "Unknown FlashTrade close error.",
        retryCountDelta: 1,
        updatedAt: Date.now(),
      });
      throw error;
    }
  },
});

export const syncFlashTradePosition: ReturnType<typeof action> = action({
  args: {
    privyUserId: v.string(),
    agentName: v.string(),
  },
  handler: async (ctx, args): Promise<FlashTradePosition | null> => {
    const context = (await ctx.runQuery(
      internal.flashtradeStore.resolveExecutionContext,
      {
        privyUserId: args.privyUserId,
        agentName: args.agentName,
      },
    )) as ResolvedExecutionContext;

    if (!context.wallet || !context.activeExecution) {
      return null;
    }

    const execution = context.activeExecution;
    const positions = await listFlashTradePositions(
      context.wallet.executionWalletAddress,
    );
    const position =
      positions.find((item) => item.key === execution.venuePositionKey) ??
      positions.find(
        (item) =>
          item.marketSymbol === execution.venueMarketSymbol &&
          item.sideUi?.toLowerCase() === execution.direction,
      ) ??
      null;

    await ctx.runMutation(internal.flashtradeStore.patchExecutionRecord, {
      executionId: execution._id,
      ...(position
        ? {
            positionSnapshot: toPositionSnapshot(position),
            status: "open" as const,
          }
        : CLOSED_EXECUTION_STATUSES.has(execution.status)
          ? {}
          : {
              failureReason:
                "Live FlashTrade position could not be found during sync.",
            }),
      updatedAt: Date.now(),
    });

    return position;
  },
});
