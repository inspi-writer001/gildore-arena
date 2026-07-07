export const vaultSnapshotKeys = {
  snapshot: (walletAddress: string, agentName: string) =>
    ["solana-vault", "snapshot", walletAddress, agentName] as const,
  fundingBalance: (walletAddress: string) =>
    ["solana-vault", "funding-balance", walletAddress] as const,
};
