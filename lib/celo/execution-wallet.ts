import { http, createPublicClient, createWalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";
import { getCeloChainFromUrl } from "../ecosystem";
import { MINIMAL_ERC20_ABI } from "./gildore-vault-celo";

const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

function celoRpcUrl(): string {
  return (
    process.env.CELO_RPC_URL ??
    process.env.NEXT_PUBLIC_CELO_RPC_URL ??
    "https://forno.celo.org"
  );
}

function createReadClient() {
  const url = celoRpcUrl();
  return createPublicClient({
    chain: getCeloChainFromUrl(url),
    transport: http(url),
  });
}

function seedToPrivateKey(seedBytes: Uint8Array): `0x${string}` {
  if (seedBytes.length !== 32) {
    throw new Error(
      `Execution wallet seed must be 32 bytes for Celo, got ${seedBytes.length}.`,
    );
  }

  return `0x${Buffer.from(seedBytes).toString("hex")}` as `0x${string}`;
}

export function createCeloExecutionWalletAccountFromSeed(seedBytes: Uint8Array) {
  return privateKeyToAccount(seedToPrivateKey(seedBytes));
}

export function createCeloExecutionWalletClientsFromSeed(seedBytes: Uint8Array) {
  const url = celoRpcUrl();
  const chain = getCeloChainFromUrl(url);
  const account = createCeloExecutionWalletAccountFromSeed(seedBytes);
  const publicClient = createPublicClient({
    chain,
    transport: http(url),
  });
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(url),
  });

  return {
    account,
    publicClient,
    walletClient,
  };
}

export async function getCeloExecutionWalletTokenBalance(args: {
  publicClient?: ReturnType<typeof createReadClient>;
  executionWalletAddress: `0x${string}`;
  tokenAddress: `0x${string}`;
}) {
  const publicClient = args.publicClient ?? createReadClient();
  const balance = (await publicClient.readContract({
    address: args.tokenAddress,
    abi: MINIMAL_ERC20_ABI,
    functionName: "balanceOf",
    args: [args.executionWalletAddress],
  })) as bigint;

  return balance;
}

export async function approveCeloExecutionWalletToken(args: {
  walletClient: ReturnType<typeof createCeloExecutionWalletClientsFromSeed>["walletClient"];
  tokenAddress: `0x${string}`;
  spender: `0x${string}`;
  amount: bigint;
}) {
  const txHash = await args.walletClient.writeContract({
    address: args.tokenAddress,
    abi: MINIMAL_ERC20_ABI,
    functionName: "approve",
    args: [args.spender, args.amount],
    account: args.walletClient.account!,
  });

  return txHash;
}

export async function transferFromCeloExecutionWallet(args: {
  walletClient: ReturnType<typeof createCeloExecutionWalletClientsFromSeed>["walletClient"];
  tokenAddress: `0x${string}`;
  recipient: `0x${string}`;
  amount: bigint;
}) {
  const txHash = await args.walletClient.writeContract({
    address: args.tokenAddress,
    abi: ERC20_TRANSFER_ABI,
    functionName: "transfer",
    args: [args.recipient, args.amount],
    account: args.walletClient.account!,
  });

  return txHash;
}
