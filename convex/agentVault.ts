"use node";

import { v } from "convex/values";
import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  prepareServerFundAgentVaultTransaction,
  prepareServerRegisterTickerTransaction,
  prepareServerWithdrawTransaction,
  submitServerRegisterTickerTransaction,
  submitServerFundAgentVaultTransaction,
  submitServerWithdrawTransaction,
  executeServerConsumeTicker,
  executeServerUpdateTickerCloseTrade,
  getFundingTokenBalanceData,
  getVaultSnapshotData,
} from "../lib/solana/server-gildore-vault";
import { decryptExecutionWalletSecret } from "../lib/server/execution-wallet-crypto";
import { createExecutionWalletSignerFromSeed } from "../lib/solana/execution-wallet";

type ResolvedExecutionWalletContext = {
  wallet: {
    executionWalletAddress: string;
    encryptedPrivateKey: string;
    encryptionSalt: string;
  } | null;
};

async function resolveExecutionWalletContext(
  ctx: ActionCtx,
  privyUserId: string | undefined,
  agentName: string,
) {
  if (!privyUserId) {
    return null;
  }

  return (await ctx.runQuery(internal.flashtradeStore.resolveExecutionContext, {
    privyUserId,
    agentName,
  })) as ResolvedExecutionWalletContext;
}

export const prepareFundAgentVault = action({
  args: {
    walletAddress: v.string(),
    agentName: v.string(),
    amountUi: v.string(),
  },
  handler: async (_ctx, args) => {
    return await prepareServerFundAgentVaultTransaction(
      args.walletAddress,
      args.agentName,
      args.amountUi,
    );
  },
});

export const submitFundAgentVault = action({
  args: {
    walletAddress: v.string(),
    signedTransactionBase64: v.string(),
  },
  handler: async (_ctx, args) => {
    return await submitServerFundAgentVaultTransaction(
      args.walletAddress,
      args.signedTransactionBase64,
    );
  },
});

export const prepareRegisterTicker = action({
  args: {
    walletAddress: v.string(),
    agentName: v.string(),
    amountUi: v.string(),
  },
  handler: async (_ctx, args) => {
    return await prepareServerRegisterTickerTransaction(
      args.walletAddress,
      args.agentName,
      args.amountUi,
    );
  },
});

export const submitRegisterTicker = action({
  args: {
    walletAddress: v.string(),
    signedTransactionBase64: v.string(),
  },
  handler: async (_ctx, args) => {
    return await submitServerRegisterTickerTransaction(
      args.walletAddress,
      args.signedTransactionBase64,
    );
  },
});

// ── Withdraw (user_withdrawal) ────────────────────────────────────────────────

export const prepareWithdraw: ReturnType<typeof action> = action({
  args: {
    walletAddress: v.string(),
    agentName: v.string(),
    amountUi: v.string(),
    privyUserId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const executionContext = await resolveExecutionWalletContext(
      ctx,
      args.privyUserId,
      args.agentName,
    );
    return await prepareServerWithdrawTransaction(
      args.walletAddress,
      args.agentName,
      args.amountUi,
      executionContext?.wallet?.executionWalletAddress,
    );
  },
});

export const submitWithdraw: ReturnType<typeof action> = action({
  args: {
    walletAddress: v.string(),
    agentName: v.string(),
    amountUi: v.string(),
    signedTransactionBase64: v.optional(v.string()),
    privyUserId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const executionContext = await resolveExecutionWalletContext(
      ctx,
      args.privyUserId,
      args.agentName,
    );
    const wallet = executionContext?.wallet ?? null;
    const executionWalletSigner = wallet
      ? await createExecutionWalletSignerFromSeed(
          decryptExecutionWalletSecret({
            encryptedPrivateKey: wallet.encryptedPrivateKey,
            encryptionSalt: wallet.encryptionSalt,
          }),
        )
      : undefined;

    return await submitServerWithdrawTransaction({
      userWalletAddress: args.walletAddress,
      agentName: args.agentName,
      amountUi: args.amountUi,
      signedTransactionBase64: args.signedTransactionBase64,
      executionWalletAddress: wallet?.executionWalletAddress,
      executionWalletSigner,
    });
  },
});

// ── Vault snapshot (on-chain read) ────────────────────────────────────────────

export const getVaultSnapshot: ReturnType<typeof action> = action({
  args: {
    walletAddress: v.string(),
    agentName: v.string(),
    privyUserId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const executionContext = await resolveExecutionWalletContext(
      ctx,
      args.privyUserId,
      args.agentName,
    );
    return await getVaultSnapshotData(
      args.walletAddress,
      args.agentName,
      executionContext?.wallet?.executionWalletAddress,
    );
  },
});

export const getFundingTokenBalance = action({
  args: {
    walletAddress: v.string(),
  },
  handler: async (_ctx, args) => {
    return await getFundingTokenBalanceData(args.walletAddress);
  },
});

// ── Admin / cron operations ───────────────────────────────────────────────────

export const consumeTicker = action({
  args: {
    walletAddress: v.string(),
    agentName: v.string(),
    destinationTokenAccount: v.string(),
  },
  handler: async (_ctx, args) => {
    return await executeServerConsumeTicker(
      args.walletAddress,
      args.agentName,
      args.destinationTokenAccount,
    );
  },
});

export const updateTickerCloseTrade = action({
  args: {
    walletAddress: v.string(),
    agentName: v.string(),
  },
  handler: async (_ctx, args) => {
    return await executeServerUpdateTickerCloseTrade(
      args.walletAddress,
      args.agentName,
    );
  },
});
