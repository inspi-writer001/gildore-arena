export const celoVaultSnapshotKeys = {
  snapshot: (walletAddress: string, agentName: string) =>
    ["celo-vault", "snapshot", walletAddress, agentName] as const,
};
