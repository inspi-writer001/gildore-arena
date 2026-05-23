"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import {
  prepareServerFundAgentVaultTransaction,
  submitServerFundAgentVaultTransaction,
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
