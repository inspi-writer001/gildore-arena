import { parseUnits, type Address, type ReadContractParameters } from "viem";

type ContractReader = {
  readContract: (args: ReadContractParameters) => Promise<unknown>;
};

export const GILDORE_VAULT_CELO_ADDRESS = process.env
  .NEXT_PUBLIC_GILDORE_VAULT_CELO_ADDRESS as Address | undefined;

// Celo USDC fee-currency *adapter* address (mainnet) — required in the
// `feeCurrency` field so MiniPay/CIP-64 transactions pay gas in USDC instead
// of CELO. Override per network via env; leave unset on testnets where the
// wallet still holds faucet CELO for gas.
export const CELO_USDC_FEE_CURRENCY_ADDRESS = process.env
  .NEXT_PUBLIC_CELO_FEE_CURRENCY_ADDRESS as Address | undefined;

export const CELO_DEPOSIT_TOKEN_ADDRESS = process.env
  .NEXT_PUBLIC_CELO_DEPOSIT_TOKEN_ADDRESS as Address | undefined;

// USDC has 6 decimals on Celo (vs. 18 for USDm/cUSD) — see celopedia-skill minipay-guide.md.
export const CELO_DEPOSIT_TOKEN_DECIMALS = Number(
  process.env.NEXT_PUBLIC_CELO_DEPOSIT_TOKEN_DECIMALS ?? "6",
);

export function parseCeloDepositAmount(amountUi: string): bigint {
  return parseUnits(amountUi, CELO_DEPOSIT_TOKEN_DECIMALS);
}

export async function getCeloAgentId(
  publicClient: ContractReader,
  contractAddress: Address,
  agentName: string,
): Promise<`0x${string}`> {
  const id = await publicClient.readContract({
    address: contractAddress,
    abi: GILDORE_VAULT_CELO_ABI,
    functionName: "deriveAgentId",
    args: [agentName],
  });
  return id as `0x${string}`;
}

export async function fetchCeloVaultSnapshot(
  publicClient: ContractReader,
  contractAddress: Address,
  userAddress: Address,
  agentName: string,
) {
  const agentId = await getCeloAgentId(publicClient, contractAddress, agentName);

  const [balance, decimals, ticker] = await Promise.all([
    publicClient.readContract({
      address: contractAddress,
      abi: GILDORE_VAULT_CELO_ABI,
      functionName: "balanceOf",
      args: [userAddress, agentId],
    }),
    publicClient.readContract({
      address: contractAddress,
      abi: GILDORE_VAULT_CELO_ABI,
      functionName: "TOKEN_DECIMALS",
      args: [],
    }),
    publicClient.readContract({
      address: contractAddress,
      abi: GILDORE_VAULT_CELO_ABI,
      functionName: "tickers",
      args: [userAddress, agentId],
    }),
  ]);

  const [amountToSpend, isInPosition] = ticker as readonly [bigint, boolean];
  return {
    decimals: Number(decimals),
    vaultBalance: (balance as bigint).toString(),
    vaultAllowance: amountToSpend.toString(),
    isInPosition,
  };
}

export const MINIMAL_ERC20_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// ABI for GildoreVaultCelo. Mirrors gildore-arena-vault-celo/src/GildoreVaultCelo.sol.
export const GILDORE_VAULT_CELO_ABI = [
  // ── Views ───────────────────────────────────────────────────────────────────
  {
    type: "function",
    name: "deriveAgentId",
    stateMutability: "view",
    inputs: [{ name: "name", type: "string" }],
    outputs: [{ name: "", type: "bytes32" }],
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
  {
    type: "function",
    name: "HARD_CAP_SPENDABLE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "MINIMUM_SPENDABLE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "TOKEN_DECIMALS",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "admins",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "broadcasters",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "tickers",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "agentId", type: "bytes32" },
    ],
    outputs: [
      { name: "amountToSpend", type: "uint256" },
      { name: "isInPosition", type: "bool" },
    ],
  },
  // ── User writes ─────────────────────────────────────────────────────────────
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
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "bytes32" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  // ── Admin/broadcaster writes ─────────────────────────────────────────────────
  {
    type: "function",
    name: "consumeTicker",
    stateMutability: "nonpayable",
    inputs: [
      { name: "user", type: "address" },
      { name: "agentId", type: "bytes32" },
      { name: "destination", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "updateTickerCloseTrade",
    stateMutability: "nonpayable",
    inputs: [
      { name: "user", type: "address" },
      { name: "agentId", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "addAdmin",
    stateMutability: "nonpayable",
    inputs: [{ name: "newAdmin", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "removeAdmin",
    stateMutability: "nonpayable",
    inputs: [{ name: "adminToRemove", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "addBroadcaster",
    stateMutability: "nonpayable",
    inputs: [{ name: "broadcaster_", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "removeBroadcaster",
    stateMutability: "nonpayable",
    inputs: [{ name: "broadcaster_", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "registerAgent",
    stateMutability: "nonpayable",
    inputs: [{ name: "name", type: "string" }],
    outputs: [{ name: "agentId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "deleteAgent",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "setFeeConfig",
    stateMutability: "nonpayable",
    inputs: [
      { name: "feeDestination_", type: "address" },
      { name: "feeBps_", type: "uint16" },
      { name: "maxFee_", type: "uint256" },
    ],
    outputs: [],
  },
] as const;
