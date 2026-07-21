"use node";

import { v } from "convex/values";
import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  getCeloVaultSnapshotData,
  executeServerUpdateTickerCloseTradeCelo,
  executeServerConsumeTickerCelo,
  sweepCeloExecutionWalletToUser,
} from "../lib/celo/server-gildore-vault-celo";
import { createCeloExecutionWalletAccountFromSeed } from "../lib/celo/execution-wallet";
import { decryptExecutionWalletSecret } from "../lib/server/execution-wallet-crypto";

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
): Promise<ResolvedExecutionWalletContext | null> {
  if (!privyUserId) {
    return null;
  }

  return (await ctx.runQuery(internal.flashtradeStore.resolveExecutionContext, {
    privyUserId,
    agentName,
  })) as ResolvedExecutionWalletContext;
}

export const getVaultSnapshotCelo: ReturnType<typeof action> = action({
  args: {
    walletAddress: v.string(),
    agentName: v.string(),
    privyUserId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<Awaited<ReturnType<typeof getCeloVaultSnapshotData>>> => {
    const executionContext = await resolveExecutionWalletContext(
      ctx,
      args.privyUserId,
      args.agentName,
    );
    const executionWalletAddress = executionContext?.wallet
      ? (() => {
          const seedBytes = decryptExecutionWalletSecret({
            encryptedPrivateKey: executionContext.wallet.encryptedPrivateKey,
            encryptionSalt: executionContext.wallet.encryptionSalt,
          });
          return createCeloExecutionWalletAccountFromSeed(seedBytes).address;
        })()
      : undefined;

    return await getCeloVaultSnapshotData(
      args.walletAddress,
      args.agentName,
      executionWalletAddress,
    );
  },
});

export const updateTickerCloseTradeCelo: ReturnType<typeof action> = action({
  args: {
    walletAddress: v.string(),
    agentName: v.string(),
  },
  handler: async (
    _ctx,
    args,
  ): Promise<Awaited<ReturnType<typeof executeServerUpdateTickerCloseTradeCelo>>> => {
    return await executeServerUpdateTickerCloseTradeCelo(
      args.walletAddress,
      args.agentName,
    );
  },
});

export const consumeTickerCelo: ReturnType<typeof action> = action({
  args: {
    walletAddress: v.string(),
    agentName: v.string(),
    destination: v.string(),
  },
  handler: async (
    _ctx,
    args,
  ): Promise<Awaited<ReturnType<typeof executeServerConsumeTickerCelo>>> => {
    return await executeServerConsumeTickerCelo(
      args.walletAddress,
      args.agentName,
      args.destination,
    );
  },
});

export const recoverExecutionWalletFundsCelo: ReturnType<typeof action> = action({
  args: {
    privyUserId: v.string(),
    walletAddress: v.string(),
    agentName: v.string(),
    amountUi: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<Awaited<ReturnType<typeof sweepCeloExecutionWalletToUser>>> => {
    const executionContext = await resolveExecutionWalletContext(
      ctx,
      args.privyUserId,
      args.agentName,
    );

    if (!executionContext?.wallet) {
      throw new Error("Execution wallet not found.");
    }

    const seedBytes = decryptExecutionWalletSecret({
      encryptedPrivateKey: executionContext.wallet.encryptedPrivateKey,
      encryptionSalt: executionContext.wallet.encryptionSalt,
    });

    return await sweepCeloExecutionWalletToUser({
      seedBytes,
      userWalletAddress: args.walletAddress,
      amountUi: args.amountUi,
    });
  },
});
