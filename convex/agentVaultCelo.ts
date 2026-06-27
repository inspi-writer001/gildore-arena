"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import {
  getCeloVaultSnapshotData,
  executeServerUpdateTickerCloseTradeCelo,
  executeServerConsumeTickerCelo,
} from "../lib/celo/server-gildore-vault-celo";

export const getVaultSnapshotCelo = action({
  args: {
    walletAddress: v.string(),
    agentName: v.string(),
  },
  handler: async (_ctx, args) => {
    return await getCeloVaultSnapshotData(args.walletAddress, args.agentName);
  },
});

export const updateTickerCloseTradeCelo = action({
  args: {
    walletAddress: v.string(),
    agentName: v.string(),
  },
  handler: async (_ctx, args) => {
    return await executeServerUpdateTickerCloseTradeCelo(
      args.walletAddress,
      args.agentName,
    );
  },
});

export const consumeTickerCelo = action({
  args: {
    walletAddress: v.string(),
    agentName: v.string(),
    destination: v.string(),
  },
  handler: async (_ctx, args) => {
    return await executeServerConsumeTickerCelo(
      args.walletAddress,
      args.agentName,
      args.destination,
    );
  },
});
