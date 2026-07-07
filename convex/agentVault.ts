"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
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

export const prepareWithdraw = action({
  args: {
    walletAddress: v.string(),
    agentName: v.string(),
    amountUi: v.string(),
  },
  handler: async (_ctx, args) => {
    return await prepareServerWithdrawTransaction(
      args.walletAddress,
      args.agentName,
      args.amountUi,
    );
  },
});

export const submitWithdraw = action({
  args: {
    walletAddress: v.string(),
    signedTransactionBase64: v.string(),
  },
  handler: async (_ctx, args) => {
    return await submitServerWithdrawTransaction(
      args.walletAddress,
      args.signedTransactionBase64,
    );
  },
});

// ── Vault snapshot (on-chain read) ────────────────────────────────────────────

export const getVaultSnapshot = action({
  args: {
    walletAddress: v.string(),
    agentName: v.string(),
  },
  handler: async (_ctx, args) => {
    return await getVaultSnapshotData(args.walletAddress, args.agentName);
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
