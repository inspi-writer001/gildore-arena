import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  CELO_DEPOSIT_TOKEN_ADDRESS,
  CELO_DEPOSIT_TOKEN_DECIMALS,
  GILDORE_VAULT_CELO_ABI,
  MINIMAL_ERC20_ABI,
} from "./gildore-vault-celo";
import { getCeloChainFromUrl } from "../ecosystem";
import {
  createCeloExecutionWalletClientsFromSeed,
  getCeloExecutionWalletTokenBalance,
  transferFromCeloExecutionWallet,
} from "./execution-wallet";

function getContractAddress(): `0x${string}` {
  const addr =
    process.env.GILDORE_VAULT_CELO_ADDRESS ??
    process.env.NEXT_PUBLIC_GILDORE_VAULT_CELO_ADDRESS;
  if (!addr) throw new Error("GILDORE_VAULT_CELO_ADDRESS is not configured");
  return addr as `0x${string}`;
}

function celoRpcUrl(): string {
  return (
    process.env.CELO_RPC_URL ??
    process.env.NEXT_PUBLIC_CELO_RPC_URL ??
    "https://forno.celo.org"
  );
}

function createReadClient() {
  const url = celoRpcUrl();
  return createPublicClient({ chain: getCeloChainFromUrl(url), transport: http(url) });
}

function createBroadcasterClients() {
  const privateKey = process.env.CELO_BROADCASTER_PRIVATE_KEY;
  if (!privateKey)
    throw new Error("CELO_BROADCASTER_PRIVATE_KEY is not configured");
  const url = celoRpcUrl();
  const chain = getCeloChainFromUrl(url);
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const publicClient = createPublicClient({ chain, transport: http(url) });
  const walletClient = createWalletClient({ account, chain, transport: http(url) });
  return { publicClient, walletClient, account };
}

async function resolveAgentId(
  publicClient: ReturnType<typeof createReadClient>,
  contractAddress: `0x${string}`,
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

export async function getCeloVaultSnapshotData(
  userWalletAddress: string,
  agentName: string,
  executionWalletAddress?: string,
) {
  const contractAddress = getContractAddress();
  const publicClient = createReadClient();
  const agentId = await resolveAgentId(publicClient, contractAddress, agentName);

  const [balance, decimals, ticker] = await Promise.all([
    publicClient.readContract({
      address: contractAddress,
      abi: GILDORE_VAULT_CELO_ABI,
      functionName: "balanceOf",
      args: [userWalletAddress as `0x${string}`, agentId],
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
      args: [userWalletAddress as `0x${string}`, agentId],
    }),
  ]);

  const [amountToSpend, isInPosition] = ticker as readonly [bigint, boolean];
  const executionWalletBalance =
    executionWalletAddress && CELO_DEPOSIT_TOKEN_ADDRESS
      ? await getCeloExecutionWalletTokenBalance({
          publicClient,
          executionWalletAddress: executionWalletAddress as `0x${string}`,
          tokenAddress: CELO_DEPOSIT_TOKEN_ADDRESS,
        })
      : BigInt(0);
  const vaultBalance = balance as bigint;
  return {
    decimals: Number(decimals),
    vaultBalance: vaultBalance.toString(),
    executionWalletBalance: executionWalletBalance.toString(),
    totalWithdrawableBalance: (vaultBalance + executionWalletBalance).toString(),
    vaultAllowance: amountToSpend.toString(),
    isInPosition,
  };
}

export async function executeServerUpdateTickerCloseTradeCelo(
  userWalletAddress: string,
  agentName: string,
) {
  const contractAddress = getContractAddress();
  const { publicClient, walletClient, account } = createBroadcasterClients();
  const agentId = await resolveAgentId(publicClient, contractAddress, agentName);

  const txHash = await walletClient.writeContract({
    address: contractAddress,
    abi: GILDORE_VAULT_CELO_ABI,
    functionName: "updateTickerCloseTrade",
    args: [userWalletAddress as `0x${string}`, agentId],
    account,
  });

  return { txHash };
}

export async function executeServerConsumeTickerCelo(
  userWalletAddress: string,
  agentName: string,
  destination: string,
) {
  const contractAddress = getContractAddress();
  const { publicClient, walletClient, account } = createBroadcasterClients();
  const agentId = await resolveAgentId(publicClient, contractAddress, agentName);

  const txHash = await walletClient.writeContract({
    address: contractAddress,
    abi: GILDORE_VAULT_CELO_ABI,
    functionName: "consumeTicker",
    args: [
      userWalletAddress as `0x${string}`,
      agentId,
      destination as `0x${string}`,
    ],
    account,
  });

  return { txHash };
}

function parseCeloUiAmountToBaseUnits(value: string) {
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error("Enter a valid withdraw amount");
  }

  const [wholePart, fractionalPart = ""] = normalized.split(".");
  if (fractionalPart.length > CELO_DEPOSIT_TOKEN_DECIMALS) {
    throw new Error(
      `Amount supports up to ${CELO_DEPOSIT_TOKEN_DECIMALS} decimal places`,
    );
  }

  const paddedFractional = fractionalPart.padEnd(
    CELO_DEPOSIT_TOKEN_DECIMALS,
    "0",
  );
  const whole = BigInt(wholePart || "0");
  const fraction = BigInt(paddedFractional || "0");
  const scale = BigInt(10) ** BigInt(CELO_DEPOSIT_TOKEN_DECIMALS);
  return whole * scale + fraction;
}

export async function sweepCeloExecutionWalletToUser(args: {
  seedBytes: Uint8Array;
  userWalletAddress: string;
  amountUi: string;
}) {
  if (!CELO_DEPOSIT_TOKEN_ADDRESS) {
    throw new Error("CELO_DEPOSIT_TOKEN_ADDRESS is not configured.");
  }

  const clients = createCeloExecutionWalletClientsFromSeed(args.seedBytes);
  const requestedAmount = parseCeloUiAmountToBaseUnits(args.amountUi);
  const availableBalance = await getCeloExecutionWalletTokenBalance({
    publicClient: clients.publicClient,
    executionWalletAddress: clients.account.address,
    tokenAddress: CELO_DEPOSIT_TOKEN_ADDRESS,
  });

  if (availableBalance === BigInt(0)) {
    return {
      txHash: null,
      withdrawnBaseUnits: "0",
    };
  }

  const amount =
    requestedAmount > availableBalance ? availableBalance : requestedAmount;
  const txHash = await transferFromCeloExecutionWallet({
    walletClient: clients.walletClient,
    tokenAddress: CELO_DEPOSIT_TOKEN_ADDRESS,
    recipient: args.userWalletAddress as Address,
    amount,
  });

  return {
    txHash,
    withdrawnBaseUnits: amount.toString(),
  };
}

export async function getCeloExecutionWalletBalanceData(
  executionWalletAddress: string,
) {
  if (!CELO_DEPOSIT_TOKEN_ADDRESS) {
    throw new Error("CELO_DEPOSIT_TOKEN_ADDRESS is not configured.");
  }

  const publicClient = createReadClient();
  const balance = await getCeloExecutionWalletTokenBalance({
    publicClient,
    executionWalletAddress: executionWalletAddress as `0x${string}`,
    tokenAddress: CELO_DEPOSIT_TOKEN_ADDRESS,
  });

  return {
    executionWalletAddress,
    balance: balance.toString(),
  };
}

export async function getCeloWalletTokenBalance(
  userWalletAddress: string,
) {
  if (!CELO_DEPOSIT_TOKEN_ADDRESS) {
    throw new Error("CELO_DEPOSIT_TOKEN_ADDRESS is not configured.");
  }

  const publicClient = createReadClient();
  const balance = (await publicClient.readContract({
    address: CELO_DEPOSIT_TOKEN_ADDRESS,
    abi: MINIMAL_ERC20_ABI,
    functionName: "balanceOf",
    args: [userWalletAddress as `0x${string}`],
  })) as bigint;

  return balance;
}
