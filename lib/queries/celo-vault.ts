export const celoVaultSnapshotKeys = {
  snapshot: (walletAddress: string, agentName: string, privyUserId = "") =>
    ["celo-vault", "snapshot", walletAddress, agentName, privyUserId] as const,
};

export const celoUsdcBalanceKeys = {
  balance: (walletAddress: string) =>
    ["celo-vault", "usdc-balance", walletAddress] as const,
};
