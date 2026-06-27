import { celo } from "viem/chains";

export type Ecosystem = "solana" | "celo";

declare global {
  interface Window {
    ethereum?: {
      isMiniPay?: boolean;
      request(...args: unknown[]): Promise<unknown>;
    };
  }
}

export function isMiniPayEnvironment(): boolean {
  return typeof window !== "undefined" && window.ethereum?.isMiniPay === true;
}

export function getCeloChain() {
  return celo;
}

export function getCeloChainFromUrl(_rpcUrl: string) {
  return celo;
}
