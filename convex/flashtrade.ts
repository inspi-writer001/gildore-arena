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
import {
  ensureSolanaTokenAta,
  getSolanaTokenWalletBalance,
  transferSolanaSplFromExecutionWallet,
} from "../lib/solana/token-wallet";
import { fetchUserVaultSnapshot } from "../lib/solana/gildore-vault";
import {
  executeServerConsumeTicker,
  executeServerUpdateTickerCloseTrade,
} from "../lib/solana/server-gildore-vault";
import {
  executeServerConsumeTickerCelo,
  executeServerUpdateTickerCloseTradeCelo,
  getCeloVaultSnapshotData,
} from "../lib/celo/server-gildore-vault-celo";
import {
  approveCeloExecutionWalletToken,
  createCeloExecutionWalletClientsFromSeed,
} from "../lib/celo/execution-wallet";
import {
  closeFlashTradePositionV2,
  createFlashTradeExecutionClient,
  depositToFlashTradeLedger,
  ensureFlashTradeSetup,
  getFlashTradeCluster,
  getFlashTradeSolanaRpcUrl,
  openFlashTradePosition as openFlashTradePositionV2,
  readFlashTradePositionSnapshot,
  resolveFlashTradeMarket,
  waitForFlashTradePositionSnapshot,
} from "../lib/flashtrade/v2";
import {
  getSquidDepositAddress,
  getSquidRoute,
  pollSquidStatus,
  type SquidTransactionRequest,
} from "../lib/squid/client";
import { BN } from "@coral-xyz/anchor";

const CELO_CHAIN_ID = "42220";
const SOLANA_MAINNET_CHAIN_ID = "solana-mainnet-beta";
const SOLANA_MAINNET_USDC_MINT =
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

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

function getCeloDepositTokenAddress() {
  const tokenAddress = process.env.NEXT_PUBLIC_CELO_DEPOSIT_TOKEN_ADDRESS?.trim();
  if (!tokenAddress) {
    throw new Error("NEXT_PUBLIC_CELO_DEPOSIT_TOKEN_ADDRESS is not configured.");
  }
  return tokenAddress as `0x${string}`;
}

function isSuccessfulSquidStatus(status: string) {
  return status === "success" || status === "partial_success";
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
    originEcosystem?: "solana" | "celo";
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

function isEvmAddress(value: string) {
  return value.startsWith("0x");
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

async function bridgeCeloExecutionWalletToSolana(args: {
  seedBytes: Uint8Array;
  amountBaseUnits: bigint;
  solanaDestinationWalletAddress: string;
}) {
  const celoClients = createCeloExecutionWalletClientsFromSeed(args.seedBytes);
  const celoDepositTokenAddress = getCeloDepositTokenAddress();
  const routeResult = await getSquidRoute({
    fromAddress: celoClients.account.address,
    fromChain: CELO_CHAIN_ID,
    fromToken: celoDepositTokenAddress,
    fromAmount: args.amountBaseUnits.toString(),
    toChain: SOLANA_MAINNET_CHAIN_ID,
    toToken: SOLANA_MAINNET_USDC_MINT,
    toAddress: args.solanaDestinationWalletAddress,
    quoteOnly: false,
  });

  if (!routeResult.route.transactionRequest) {
    throw new Error("Squid did not return a transaction request for the Celo bridge.");
  }

  const transactionRequest = routeResult.route.transactionRequest;
  if (!("target" in transactionRequest) || !transactionRequest.target) {
    throw new Error(
      "Squid returned a non-EVM transaction request for the Celo-origin bridge.",
    );
  }
  const evmTransactionRequest = transactionRequest as {
    target: `0x${string}`;
    data: `0x${string}`;
    value?: string;
    gasLimit?: string;
  };

  await approveCeloExecutionWalletToken({
    walletClient: celoClients.walletClient,
    tokenAddress: celoDepositTokenAddress,
    spender: evmTransactionRequest.target,
    amount: args.amountBaseUnits,
  });

  const sourceTxHash = await celoClients.walletClient.sendTransaction({
    account: celoClients.account,
    to: evmTransactionRequest.target,
    data: evmTransactionRequest.data,
    value: BigInt(evmTransactionRequest.value ?? "0"),
    gas: evmTransactionRequest.gasLimit
      ? BigInt(evmTransactionRequest.gasLimit)
      : undefined,
  });

  if (!routeResult.requestId) {
    throw new Error("Squid route requestId is missing.");
  }
  if (!routeResult.route.quoteId) {
    throw new Error("Squid route quoteId is missing.");
  }

  const status = await pollSquidStatus({
    params: {
      transactionId: sourceTxHash,
      requestId: routeResult.requestId,
      quoteId: routeResult.route.quoteId,
      fromChainId: CELO_CHAIN_ID,
      toChainId: SOLANA_MAINNET_CHAIN_ID,
    },
  });

  if (!isSuccessfulSquidStatus(status.squidTransactionStatus)) {
    throw new Error(
      `Squid Celo-to-Solana bridge finished with ${status.squidTransactionStatus}.`,
    );
  }

  return {
    sourceExecutionWalletAddress: celoClients.account.address,
    routeRequestId: routeResult.requestId,
    routeQuoteId: routeResult.route.quoteId,
    sourceTxHash,
    status: status.squidTransactionStatus,
  };
}

async function bridgeSolanaExecutionWalletToCelo(args: {
  seedBytes: Uint8Array;
  amountBaseUnits: bigint;
  celoDestinationWalletAddress: `0x${string}`;
}) {
  const sourceSigner = await createExecutionWalletSignerFromSeed(args.seedBytes);
  const routeResult = await getSquidRoute({
    fromAddress: sourceSigner.address,
    fromChain: SOLANA_MAINNET_CHAIN_ID,
    fromToken: SOLANA_MAINNET_USDC_MINT,
    fromAmount: args.amountBaseUnits.toString(),
    toChain: CELO_CHAIN_ID,
    toToken: getCeloDepositTokenAddress(),
    toAddress: args.celoDestinationWalletAddress,
    quoteOnly: false,
  });

  if (!routeResult.route.transactionRequest) {
    throw new Error("Squid did not return a transaction request for the Solana bridge.");
  }

  const transactionRequest = routeResult.route
    .transactionRequest as SquidTransactionRequest;

  if (transactionRequest.type === "CHAINFLIP_DEPOSIT_ADDRESS") {
    const deposit = await getSquidDepositAddress(
      transactionRequest as Record<string, unknown>,
    );
    const transfer = await transferSolanaSplFromExecutionWallet({
      seedBytes: args.seedBytes,
      sourceMintAddress: SOLANA_MAINNET_USDC_MINT,
      destinationTokenAccount: deposit.depositAddress,
      amount: BigInt(deposit.amount),
      decimals: 6,
      rpcUrl: getFlashTradeSolanaRpcUrl(),
    });

    const status = await pollSquidStatus({
      params: {
        transactionId: deposit.chainflipStatusTrackingId,
        fromChainId: SOLANA_MAINNET_CHAIN_ID,
        toChainId: CELO_CHAIN_ID,
        bridgeType: "chainflipmultihop",
      },
    });

    if (!isSuccessfulSquidStatus(status.squidTransactionStatus)) {
      throw new Error(
        `Squid Solana-to-Celo bridge finished with ${status.squidTransactionStatus}.`,
      );
    }

    return {
      sourceTxHash: transfer.signature,
      bridgeTrackingId: deposit.chainflipStatusTrackingId,
      routeRequestId: routeResult.requestId,
      routeQuoteId: routeResult.route.quoteId ?? null,
      status: status.squidTransactionStatus,
    };
  }

  throw new Error(
    `Unsupported Squid Solana-source transaction request type: ${transactionRequest.type ?? "unknown"}.`,
  );
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
    const executionWalletFundingAta =
      args.originEcosystem === "solana"
        ? await ensureExecutionWalletFundingAta(signer.address)
        : null;
    const celoExecutionWallet =
      args.originEcosystem === "celo"
        ? createCeloExecutionWalletClientsFromSeed(decryptedSeed)
        : null;

    await ctx.runMutation(internal.flashtradeStore.patchExecutionRecord, {
      executionId: executionRecord._id,
      status: "funding_confirmed",
      updatedAt: Date.now(),
    });

    if (
      args.originEcosystem === "celo" &&
      getFlashTradeCluster() !== "mainnet-beta"
    ) {
      throw new Error(
        "Celo-to-FlashTrade execution requires FlashTrade mainnet-beta configuration.",
      );
    }

    await assertExecutionWalletHasGas(
      signer.address,
      BigInt(200_000),
      args.originEcosystem === "celo"
        ? getFlashTradeSolanaRpcUrl()
        : undefined,
    );
    const setupResult = await ensureFlashTradeSetup(
      flashExecutionClient,
      resolvedMarket,
    );

    let vaultConsumeSignature: string | null = null;
    let fundingTokenAccount: string | null = executionWalletFundingAta
      ? String(executionWalletFundingAta.ataAddress)
      : null;
    if (args.originEcosystem === "solana") {
      if (!executionWalletFundingAta) {
        throw new Error("Execution wallet funding ATA was not prepared.");
      }
      const consume = await executeServerConsumeTicker(
        args.walletAddress,
        args.agentName,
        executionWalletFundingAta.ataAddress,
      );
      vaultConsumeSignature = consume.signature;
    } else {
      if (!celoExecutionWallet) {
        throw new Error("Celo execution wallet was not prepared.");
      }

      const celoVaultSnapshot = await getCeloVaultSnapshotData(
        args.walletAddress,
        args.agentName,
        celoExecutionWallet.account.address,
      );
      const celoPrincipalBaseUnits = computeExpectedPrincipal({
        vaultBalance: BigInt(celoVaultSnapshot.vaultBalance),
        amountToSpend: BigInt(celoVaultSnapshot.vaultAllowance),
        decimals: celoVaultSnapshot.decimals,
      });

      if (celoPrincipalBaseUnits !== principalBaseUnits) {
        throw new Error(
          `Celo principal mismatch. Expected ${principalBaseUnits.toString()} base units, got ${celoPrincipalBaseUnits.toString()}.`,
        );
      }

      const consume = await executeServerConsumeTickerCelo(
        args.walletAddress,
        args.agentName,
        celoExecutionWallet.account.address,
      );
      vaultConsumeSignature = consume.txHash;

      await bridgeCeloExecutionWalletToSolana({
        seedBytes: decryptedSeed,
        amountBaseUnits: principalBaseUnits,
        solanaDestinationWalletAddress: signer.address,
      });

      const solanaFundingAta = await ensureSolanaTokenAta({
        ownerAddress: signer.address,
        mintAddress: SOLANA_MAINNET_USDC_MINT,
        rpcUrl: getFlashTradeSolanaRpcUrl(),
        logScope: "flashtrade:celo-open",
      });
      fundingTokenAccount = solanaFundingAta.ataAddress;

      const bridgedBalance = await getSolanaTokenWalletBalance({
        ownerAddress: signer.address,
        mintAddress: SOLANA_MAINNET_USDC_MINT,
        rpcUrl: getFlashTradeSolanaRpcUrl(),
      });
      if (bridgedBalance.balance < principalBaseUnits) {
        throw new Error(
          `Squid bridge delivered ${bridgedBalance.balance.toString()} base units to the Solana execution wallet, below the ${principalBaseUnits.toString()} required for FlashTrade.`,
        );
      }
    }

    await ctx.runMutation(internal.flashtradeStore.patchExecutionRecord, {
      executionId: executionRecord._id,
      status: "open_submitted",
      vaultConsumeSignature: vaultConsumeSignature ?? undefined,
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
      fundingTokenAccount,
      executionId: executionRecord._id,
      vaultConsumeSignature,
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

export const openFlashTradePositionCelo: ReturnType<typeof action> = action({
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
      originEcosystem: "celo",
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
      const vaultClose = isEvmAddress(args.walletAddress)
        ? await executeServerUpdateTickerCloseTradeCelo(
            args.walletAddress,
            args.agentName,
          )
        : await executeServerUpdateTickerCloseTrade(
            args.walletAddress,
            args.agentName,
          );

      return {
        clearedTickerOnly: true,
        vaultCloseSignature:
          "signature" in vaultClose ? vaultClose.signature : vaultClose.txHash,
      };
    }
    if (!context.wallet) {
      throw new Error("Execution wallet not found.");
    }

    const execution = context.activeExecution;
    const originEcosystem = execution.originEcosystem ?? "solana";
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
      await assertExecutionWalletHasGas(
        signer.address,
        BigInt(200_000),
        originEcosystem === "celo" ? getFlashTradeSolanaRpcUrl() : undefined,
      );
      const closeResult = await closeFlashTradePositionV2({
        executionClient: flashExecutionClient,
        resolvedMarket,
      });
      const vaultClose = originEcosystem === "celo"
        ? await executeServerUpdateTickerCloseTradeCelo(
            args.walletAddress,
            args.agentName,
          )
        : await executeServerUpdateTickerCloseTrade(
            args.walletAddress,
            args.agentName,
          );

      let settlementStatus:
        | "blocked_program_constraint"
        | "settled"
        | "pending" = originEcosystem === "celo"
        ? "settled"
        : "blocked_program_constraint";
      let status: "closed" | "closed_pending_settlement" =
        originEcosystem === "celo" ? "closed" : "closed_pending_settlement";
      let failureReason: string | undefined;

      if (originEcosystem === "celo") {
        try {
          const celoExecutionWallet =
            createCeloExecutionWalletClientsFromSeed(decryptedSeed);
          const solanaBalance = await getSolanaTokenWalletBalance({
            ownerAddress: signer.address,
            mintAddress: SOLANA_MAINNET_USDC_MINT,
            rpcUrl: getFlashTradeSolanaRpcUrl(),
          });

          if (solanaBalance.balance > BigInt(0)) {
            await bridgeSolanaExecutionWalletToCelo({
              seedBytes: decryptedSeed,
              amountBaseUnits: solanaBalance.balance,
              celoDestinationWalletAddress: celoExecutionWallet.account.address,
            });
          }
        } catch (bridgeError) {
          settlementStatus = "pending";
          status = "closed_pending_settlement";
          failureReason =
            bridgeError instanceof Error
              ? bridgeError.message
              : "Failed to bridge settled collateral back to the Celo execution wallet.";
        }
      }

      await ctx.runMutation(internal.flashtradeStore.patchExecutionRecord, {
        executionId: execution._id,
        status,
        settlementStatus,
        venueCloseSignature: closeResult.signature,
        vaultCloseSignature:
          "signature" in vaultClose ? vaultClose.signature : vaultClose.txHash,
        returnedAmountUi: activePosition.collateralUsdUi,
        realizedPnlUi: activePosition.pnlWithFeeUsdUi,
        failureReason,
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
        vaultCloseSignature:
          "signature" in vaultClose ? vaultClose.signature : vaultClose.txHash,
        returnedAmountUi: activePosition.collateralUsdUi ?? null,
        realizedPnlUi: activePosition.pnlWithFeeUsdUi ?? null,
        settlementStatus,
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
