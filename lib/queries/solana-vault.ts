export const vaultSnapshotKeys = {
  snapshot: (walletAddress: string, agentName: string) =>
    ["solana-vault", "snapshot", walletAddress, agentName] as const,
};
