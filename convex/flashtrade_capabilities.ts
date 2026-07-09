import { query } from "./_generated/server";

const SUPPORTED_APP_MARKETS = [
  "XAU/USD",
  "XAG/USD",
  "EUR/USD",
  "GBP/USD",
] as const;

function getFlashTradeCluster() {
  const configured = process.env.FLASH_V2_CLUSTER?.trim();
  if (configured === "devnet" || configured === "mainnet-beta") {
    return configured;
  }

  const rpcUrl =
    process.env.FLASH_V2_SOLANA_RPC?.trim() ??
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ??
    "https://api.devnet.solana.com";
  return rpcUrl.includes("devnet") ? "devnet" : "mainnet-beta";
}

export const getFlashTradeCapabilities = query({
  args: {},
  handler: async () => {
    const cluster = getFlashTradeCluster();
    return {
      cluster,
      supportedAppMarkets: [...SUPPORTED_APP_MARKETS],
      supportedTargets: [
        {
          appMarketSymbol: "XAU/USD",
          targetSymbol: "XAU",
          poolName: cluster === "devnet" ? "devnet.2" : "Crypto.1",
          longSupported: true,
          shortSupported: true,
        },
        {
          appMarketSymbol: "XAG/USD",
          targetSymbol: "XAG",
          poolName: cluster === "devnet" ? "devnet.2" : "Crypto.1",
          longSupported: true,
          shortSupported: true,
        },
        {
          appMarketSymbol: "EUR/USD",
          targetSymbol: "EUR",
          poolName: cluster === "devnet" ? "devnet.2" : "Crypto.1",
          longSupported: true,
          shortSupported: true,
        },
        {
          appMarketSymbol: "GBP/USD",
          targetSymbol: "GBP",
          poolName: cluster === "devnet" ? "devnet.2" : "Crypto.1",
          longSupported: true,
          shortSupported: true,
        },
      ],
    };
  },
});
