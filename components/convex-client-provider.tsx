"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
} from "@solana/kit";
import {
  useWallets,
  type UiWallet,
  type UiWalletAccount,
} from "@wallet-standard/react";

const solanaRpcUrl =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
  "https://api.mainnet-beta.solana.com";
const solanaSubscriptionsUrl =
  process.env.NEXT_PUBLIC_SOLANA_RPC_SUBSCRIPTIONS_URL ??
  solanaRpcUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
const solanaChain = solanaRpcUrl.includes("devnet")
  ? "solana:devnet"
  : solanaRpcUrl.includes("testnet")
    ? "solana:testnet"
    : "solana:mainnet";

type SolanaWalletContextValue = {
  rpc: ReturnType<typeof createSolanaRpc>;
  rpcSubscriptions: ReturnType<typeof createSolanaRpcSubscriptions>;
  chain: typeof solanaChain;
  wallets: UiWallet[];
  selectedWallet: UiWallet | null;
  selectedAccount: UiWalletAccount | null;
  isConnected: boolean;
  setWalletAndAccount: (
    wallet: UiWallet | null,
    account: UiWalletAccount | null,
  ) => void;
};

const SolanaWalletContext = createContext<SolanaWalletContextValue | null>(null);

export function useSolanaWallet() {
  const context = useContext(SolanaWalletContext);

  if (!context) {
    throw new Error(
      "useSolanaWallet must be used within ConvexClientProvider.",
    );
  }

  return context;
}

export default function ConvexClientProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [client] = useState(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;

    if (!url) {
      throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured.");
    }

    return new ConvexReactClient(url);
  });
  const [rpc] = useState(() =>
    createSolanaRpc(solanaRpcUrl as Parameters<typeof createSolanaRpc>[0]),
  );
  const [rpcSubscriptions] = useState(() =>
    createSolanaRpcSubscriptions(
      solanaSubscriptionsUrl as Parameters<
        typeof createSolanaRpcSubscriptions
      >[0],
    ),
  );
  const [selectedWalletName, setSelectedWalletName] = useState<string | null>(
    null,
  );
  const [selectedAccountAddress, setSelectedAccountAddress] = useState<
    string | null
  >(null);
  const discoveredWallets = useWallets();
  const wallets = useMemo(
    () =>
      discoveredWallets.filter((wallet) =>
        wallet.chains.some((chain) => chain.startsWith("solana:")),
      ),
    [discoveredWallets],
  );
  const selectedWallet = useMemo(
    () => wallets.find((wallet) => wallet.name === selectedWalletName) ?? null,
    [selectedWalletName, wallets],
  );
  const selectedAccount = useMemo(
    () =>
      selectedWallet?.accounts.find(
        (account) => account.address === selectedAccountAddress,
      ) ?? null,
    [selectedAccountAddress, selectedWallet],
  );
  const solanaWalletContextValue = useMemo<SolanaWalletContextValue>(
    () => ({
      rpc,
      rpcSubscriptions,
      chain: solanaChain,
      wallets,
      selectedWallet,
      selectedAccount,
      isConnected: Boolean(selectedWallet && selectedAccount),
      setWalletAndAccount: (wallet, account) => {
        setSelectedWalletName(wallet?.name ?? null);
        setSelectedAccountAddress(account?.address ?? null);
      },
    }),
    [rpc, rpcSubscriptions, wallets, selectedWallet, selectedAccount],
  );

  return (
    <SolanaWalletContext.Provider value={solanaWalletContextValue}>
      <ConvexProvider client={client}>{children}</ConvexProvider>
    </SolanaWalletContext.Provider>
  );
}
