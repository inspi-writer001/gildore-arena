export const celoVaultSnapshotKeys = {
  snapshot: (walletAddress: string, agentName: string) =>
    ["celo-vault", "snapshot", walletAddress, agentName] as const,
};

export const celoUsdcBalanceKeys = {
  balance: (walletAddress: string) =>
    ["celo-vault", "usdc-balance", walletAddress] as const,
};
