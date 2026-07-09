export const vaultSnapshotKeys = {
  snapshot: (walletAddress: string, agentName: string, privyUserId?: string) =>
    ["solana-vault", "snapshot", walletAddress, agentName, privyUserId ?? ""] as const,
  fundingBalance: (walletAddress: string) =>
    ["solana-vault", "funding-balance", walletAddress] as const,
};
