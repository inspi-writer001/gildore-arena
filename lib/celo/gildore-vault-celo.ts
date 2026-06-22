import { parseUnits, type Address } from "viem";

export const GILDORE_VAULT_CELO_ADDRESS = process.env
  .NEXT_PUBLIC_GILDORE_VAULT_CELO_ADDRESS as Address | undefined;

// Celo USDC fee-currency *adapter* address (mainnet) — required in the
// `feeCurrency` field so MiniPay/CIP-64 transactions pay gas in USDC instead
// of CELO. Override per network via env; leave unset on testnets where the
// wallet still holds faucet CELO for gas.
export const CELO_USDC_FEE_CURRENCY_ADDRESS = process.env
  .NEXT_PUBLIC_CELO_FEE_CURRENCY_ADDRESS as Address | undefined;

// USDC has 6 decimals on Celo (vs. 18 for USDm/cUSD) — see celopedia-skill minipay-guide.md.
export const CELO_DEPOSIT_TOKEN_DECIMALS = Number(
  process.env.NEXT_PUBLIC_CELO_DEPOSIT_TOKEN_DECIMALS ?? "6",
);

export function parseCeloDepositAmount(amountUi: string): bigint {
  return parseUnits(amountUi, CELO_DEPOSIT_TOKEN_DECIMALS);
}

// Minimal ABI for the four functions the app calls. Mirrors
// gildore-arena-vault-celo/src/GildoreVaultCelo.sol.
export const GILDORE_VAULT_CELO_ABI = [
  {
    type: "function",
    name: "deriveAgentId",
    stateMutability: "view",
    inputs: [{ name: "name", type: "string" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "depositForAgentUse",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "bytes32" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "registerTickerForMe",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "bytes32" },
      { name: "amountToSpend", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "agentId", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
