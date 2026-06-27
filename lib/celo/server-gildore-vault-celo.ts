import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { GILDORE_VAULT_CELO_ABI } from "./gildore-vault-celo";
import { getCeloChainFromUrl } from "../ecosystem";

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
  return {
    decimals: Number(decimals),
    vaultBalance: (balance as bigint).toString(),
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
