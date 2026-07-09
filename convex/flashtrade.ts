"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, type ActionCtx } from "./_generated/server";
import {
  decryptExecutionWalletSecret,
  encryptExecutionWalletSecret,
} from "../lib/server/execution-wallet-crypto";
import {
  assertExecutionWalletHasGas,
  createRpc,
  createExecutionWalletSeed,
  createExecutionWalletSignerFromSeed,
  ensureExecutionWalletFundingAta,
} from "../lib/solana/execution-wallet";
import { fetchUserVaultSnapshot } from "../lib/solana/gildore-vault";
import {
  executeServerConsumeTicker,
  executeServerUpdateTickerCloseTrade,
} from "../lib/solana/server-gildore-vault";
import {
  closeFlashTradePositionV2,
  createFlashTradeExecutionClient,
  depositToFlashTradeLedger,
  ensureFlashTradeSetup,
  openFlashTradePosition as openFlashTradePositionV2,
  readFlashTradePositionSnapshot,
  resolveFlashTradeMarket,
  waitForFlashTradePositionSnapshot,
} from "../lib/flashtrade/v2";
import { BN } from "@coral-xyz/anchor";

const CLOSED_EXECUTION_STATUSES = new Set([
  "closed",
  "closed_pending_settlement",
  "failed",
]);

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
    return args.amountToSpend > args.vaultBalance
      ? args.vaultBalance
      : args.amountToSpend;
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

function toPositionSnapshot(
  position:
    | Awaited<ReturnType<typeof readFlashTradePositionSnapshot>>
    | null,
) {
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
    marketSymbol: string;
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

  const resolvedMarket = resolveFlashTradeMarket({
    appMarketSymbol: args.marketSymbol,
    direction,
    allowManualFallback: Boolean(args.isManualTest),
  });

  if (resolvedMarket.collateralSymbol !== "USDC") {
    throw new Error(
      `FlashTrade ${resolvedMarket.targetSymbol} ${direction} on ${resolvedMarket.poolName} requires ${resolvedMarket.collateralSymbol} collateral, but the current vault execution path only funds USDC.`,
    );
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
    vaultBalance: vaultSnapshot.vaultBalance,
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
      venueMarketSymbol: resolvedMarket.targetSymbol,
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
    const flashExecutionClient = createFlashTradeExecutionClient(decryptedSeed);
    const ata = await ensureExecutionWalletFundingAta(signer.address);

    await ctx.runMutation(internal.flashtradeStore.patchExecutionRecord, {
      executionId: executionRecord._id,
      status: "funding_confirmed",
      updatedAt: Date.now(),
    });

    await assertExecutionWalletHasGas(signer.address);
    const setupResult = await ensureFlashTradeSetup(
      flashExecutionClient,
      resolvedMarket,
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
    const depositSignature = await depositToFlashTradeLedger({
      executionClient: flashExecutionClient,
      resolvedMarket,
      amount: new BN(principalBaseUnits.toString()),
    });
    const openResult = await openFlashTradePositionV2({
      executionClient: flashExecutionClient,
      resolvedMarket,
      collateralAmount: new BN(principalBaseUnits.toString()),
      leverage,
      slippagePercentage,
    });
    const openedPosition = await waitForFlashTradePositionSnapshot({
      executionClient: flashExecutionClient,
      resolvedMarket,
    });

    await ctx.runMutation(internal.flashtradeStore.patchExecutionRecord, {
      executionId: executionRecord._id,
      status: "open",
      preview: {
        newEntryPrice:
          openedPosition?.entryPriceUi ??
          ("entryPrice" in openResult.quote &&
          openResult.quote.entryPrice
            ? String(openResult.quote.entryPrice.price)
            : undefined),
        newLeverage: openedPosition?.leverageUi ?? leverage.toString(),
        newLiquidationPrice:
          openedPosition?.liquidationPriceUi ??
          ("liquidationPrice" in openResult.quote &&
          openResult.quote.liquidationPrice
            ? String(openResult.quote.liquidationPrice.price)
            : undefined),
        youPayUsdUi: principalAmountUi,
      },
      venueOpenSignature: openResult.signature,
      venuePositionKey:
        openedPosition?.venuePositionKey ?? resolvedMarket.market.toBase58(),
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
      flashSetupSignature:
        setupResult.delegateSignature ??
        setupResult.basketSignature ??
        setupResult.depositLedgerSignature,
      flashDepositSignature: depositSignature,
      venueOpenSignature: openResult.signature,
      venuePositionKey:
        openedPosition?.venuePositionKey ?? resolvedMarket.market.toBase58(),
      venueMarketSymbol: resolvedMarket.targetSymbol,
      preview: {
        entryPrice: openedPosition?.entryPriceUi ?? null,
        leverage: openedPosition?.leverageUi ?? leverage.toString(),
        liquidationPrice: openedPosition?.liquidationPriceUi ?? null,
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

    if (!context.activeExecution) {
      const vaultClose = await executeServerUpdateTickerCloseTrade(
        args.walletAddress,
        args.agentName,
      );

      return {
        clearedTickerOnly: true,
        vaultCloseSignature: vaultClose.signature,
      };
    }
    if (!context.wallet) {
      throw new Error("Execution wallet not found.");
    }

    const execution = context.activeExecution;
    const decryptedSeed = decryptExecutionWalletSecret({
      encryptedPrivateKey: context.wallet.encryptedPrivateKey,
      encryptionSalt: context.wallet.encryptionSalt,
    });
    const signer = await createExecutionWalletSignerFromSeed(decryptedSeed);
    const flashExecutionClient = createFlashTradeExecutionClient(decryptedSeed);
    const resolvedMarket = resolveFlashTradeMarket({
      targetSymbol: execution.venueMarketSymbol,
      direction: execution.direction,
    });
    const activePosition = await readFlashTradePositionSnapshot({
      executionClient: flashExecutionClient,
      resolvedMarket,
    });

    if (
      !activePosition ||
      (execution.venuePositionKey &&
        activePosition.venuePositionKey !== execution.venuePositionKey)
    ) {
      throw new Error("No matching live FlashTrade v2 position found to close.");
    }

    await ctx.runMutation(internal.flashtradeStore.patchExecutionRecord, {
      executionId: execution._id,
      status: "close_submitted",
      updatedAt: Date.now(),
    });

    try {
      await assertExecutionWalletHasGas(signer.address);
      const closeResult = await closeFlashTradePositionV2({
        executionClient: flashExecutionClient,
        resolvedMarket,
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
        returnedAmountUi: activePosition.collateralUsdUi,
        realizedPnlUi: activePosition.pnlWithFeeUsdUi,
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
        returnedAmountUi: activePosition.collateralUsdUi ?? null,
        realizedPnlUi: activePosition.pnlWithFeeUsdUi ?? null,
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
  handler: async (ctx, args): Promise<ReturnType<typeof toPositionSnapshot> | null> => {
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
    const decryptedSeed = decryptExecutionWalletSecret({
      encryptedPrivateKey: context.wallet.encryptedPrivateKey,
      encryptionSalt: context.wallet.encryptionSalt,
    });
    const flashExecutionClient = createFlashTradeExecutionClient(decryptedSeed);
    const resolvedMarket = resolveFlashTradeMarket({
      targetSymbol: execution.venueMarketSymbol,
      direction: execution.direction,
    });
    const position = await readFlashTradePositionSnapshot({
      executionClient: flashExecutionClient,
      resolvedMarket,
    });

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

    return toPositionSnapshot(position) ?? null;
  },
});
