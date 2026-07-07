"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
} from "@solana/kit";
import {
  PrivyProvider,
  useLogin,
  useLogout,
  usePrivy,
  useWallets as useEthereumWallets,
} from "@privy-io/react-auth";
import {
  useWallets,
  type ConnectedStandardSolanaWallet,
} from "@privy-io/react-auth/solana";
import { createPublicClient, createWalletClient, custom, http } from "viem";
import { isMiniPayEnvironment, getCeloChain, type Ecosystem } from "@/lib/ecosystem";

const solanaRpcUrl =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
  "https://api.devnet.solana.com";
const solanaSubscriptionsUrl =
  process.env.NEXT_PUBLIC_SOLANA_RPC_SUBSCRIPTIONS_URL ??
  solanaRpcUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
const solanaChain = solanaRpcUrl.includes("devnet")
  ? "solana:devnet"
  : solanaRpcUrl.includes("testnet")
    ? "solana:testnet"
    : "solana:mainnet";
const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const privyClientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID;
const celoRpcUrl = process.env.NEXT_PUBLIC_CELO_RPC_URL ?? "https://forno.celo.org";
const celoChain = getCeloChain();
const solanaRpc = createSolanaRpc(
  solanaRpcUrl as Parameters<typeof createSolanaRpc>[0],
);
const solanaRpcSubscriptions = createSolanaRpcSubscriptions(
  solanaSubscriptionsUrl as Parameters<typeof createSolanaRpcSubscriptions>[0],
);
const celoPublicClient = createPublicClient({
  chain: celoChain,
  transport: http(celoRpcUrl),
});
const ECOSYSTEM_STORAGE_KEY = "gildore-ecosystem";

export type EcosystemWalletState = {
  ecosystem: Ecosystem;
  setEcosystem: (ecosystem: Ecosystem) => void;
  isMiniPay: boolean;
  ready: boolean;
  isAuthenticated: boolean;
  isConnected: boolean;
  privyUserId: string | null;
  userEmail: string | null;
  address: string | null;
  chain: string;
  login: () => void;
  logout: () => Promise<void>;
  celoPublicClient: typeof celoPublicClient;
  getCeloWalletClient: () => Promise<ReturnType<typeof createWalletClient> | null>;
};

export type SolanaWalletState = {
  rpc: typeof solanaRpc;
  rpcSubscriptions: typeof solanaRpcSubscriptions;
  chain: typeof solanaChain;
  ready: boolean;
  isAuthenticated: boolean;
  isConnected: boolean;
  privyUserId: string | null;
  userEmail: string | null;
  selectedWallet: ConnectedStandardSolanaWallet | null;
  selectedAccount: { address: string } | null;
  wallets: ConnectedStandardSolanaWallet[];
  login: () => void;
  logout: () => Promise<void>;
};

function selectPreferredWallet(
  wallets: ConnectedStandardSolanaWallet[],
): ConnectedStandardSolanaWallet | null {
  return (
    wallets.find((wallet) => wallet.standardWallet.name === "Privy") ??
    wallets.at(0) ??
    null
  );
}

export function useSolanaWallet(): SolanaWalletState {
  const { ready, authenticated, user } = usePrivy();
  const { login } = useLogin();
  const { logout } = useLogout();
  const { ready: walletsReady, wallets } = useWallets();
  const selectedWallet = useMemo(
    () => selectPreferredWallet(wallets),
    [wallets],
  );
  const userEmail =
    user?.email?.address ??
    user?.google?.email ??
    user?.github?.email ??
    user?.discord?.email ??
    null;

  return {
    rpc: solanaRpc,
    rpcSubscriptions: solanaRpcSubscriptions,
    chain: solanaChain,
    ready: ready && walletsReady,
    isAuthenticated: authenticated,
    isConnected: authenticated && Boolean(selectedWallet),
    privyUserId: user?.id ?? null,
    userEmail,
    selectedWallet,
    selectedAccount: selectedWallet
      ? { address: selectedWallet.address }
      : null,
    wallets,
    login: () => login(),
    logout,
  };
}

function readStoredEcosystem(): Ecosystem {
  if (typeof window === "undefined") return "solana";
  return window.localStorage.getItem(ECOSYSTEM_STORAGE_KEY) === "celo"
    ? "celo"
    : "solana";
}

export function useEcosystemWallet(): EcosystemWalletState {
  const { ready, authenticated, user } = usePrivy();
  const { login } = useLogin();
  const { logout } = useLogout();
  const { wallets: solanaWallets } = useWallets();
  const { wallets: ethereumWallets } = useEthereumWallets();
  const isMiniPay = useMemo(() => isMiniPayEnvironment(), []);
  const [ecosystem, setEcosystemState] = useState<Ecosystem>(() =>
    isMiniPay ? "celo" : readStoredEcosystem(),
  );
  const [miniPayAddress, setMiniPayAddress] = useState<string | null>(null);

  useEffect(() => {
    if (!isMiniPay || typeof window === "undefined" || !window.ethereum) return;
    createWalletClient({ chain: celoChain, transport: custom(window.ethereum) })
      .getAddresses()
      .then((addresses) => setMiniPayAddress(addresses[0] ?? null))
      .catch((error) => {
        console.error("[ecosystem-wallet] MiniPay auto-connect failed", error);
      });
  }, [isMiniPay]);

  const setEcosystem = (next: Ecosystem) => {
    if (isMiniPay) return;
    setEcosystemState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ECOSYSTEM_STORAGE_KEY, next);
    }
  };

  const userEmail =
    user?.email?.address ??
    user?.google?.email ??
    user?.github?.email ??
    user?.discord?.email ??
    null;
  const selectedSolanaWallet = selectPreferredWallet(solanaWallets);
  const privyEthereumWallet = ethereumWallets.at(0) ?? null;

  const getCeloWalletClient = async (): Promise<ReturnType<
    typeof createWalletClient
  > | null> => {
    if (isMiniPay) {
      if (typeof window === "undefined" || !window.ethereum) return null;
      return createWalletClient({ chain: celoChain, transport: custom(window.ethereum) });
    }
    if (!privyEthereumWallet) return null;
    const provider = await privyEthereumWallet.getEthereumProvider();
    return createWalletClient({ chain: celoChain, transport: custom(provider) });
  };

  const shared = {
    setEcosystem,
    isMiniPay,
    privyUserId: user?.id ?? null,
    userEmail,
    login: isMiniPay ? () => {} : () => login(),
    logout: isMiniPay ? async () => {} : logout,
    celoPublicClient,
    getCeloWalletClient,
  };

  if (ecosystem === "celo") {
    return {
      ...shared,
      ecosystem: "celo",
      ready: isMiniPay ? true : ready,
      isAuthenticated: isMiniPay ? Boolean(miniPayAddress) : authenticated,
      isConnected: isMiniPay
        ? Boolean(miniPayAddress)
        : authenticated && Boolean(privyEthereumWallet),
      address: isMiniPay ? miniPayAddress : (privyEthereumWallet?.address ?? null),
      chain: "celo:mainnet",
    };
  }

  return {
    ...shared,
    ecosystem: "solana",
    ready,
    isAuthenticated: authenticated,
    isConnected: authenticated && Boolean(selectedSolanaWallet),
    address: selectedSolanaWallet?.address ?? null,
    chain: solanaChain,
  };
}

const queryClient = new QueryClient();

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

  if (!privyAppId) {
    throw new Error("NEXT_PUBLIC_PRIVY_APP_ID is not configured.");
  }

  return (
    <QueryClientProvider client={queryClient}>
    <PrivyProvider
      appId={privyAppId}
      clientId={privyClientId}
      config={{
        appearance: {
          theme: "dark",
          walletChainType: "ethereum-and-solana",
          landingHeader: "Enter Gildore Arena",
          loginMessage: "Create your embedded vault wallet to fund agents.",
          showWalletLoginFirst: false,
        },
        embeddedWallets: {
          solana: {
            createOnLogin: "users-without-wallets",
          },
          ethereum: {
            createOnLogin: "users-without-wallets",
          },
        },
        supportedChains: [celoChain],
        defaultChain: celoChain,
        solana: {
          rpcs: {
            [solanaChain]: {
              rpc: solanaRpc as never,
              rpcSubscriptions: solanaRpcSubscriptions as never,
            },
          },
        },
      }}
    >
      <ConvexProvider client={client}>{children}</ConvexProvider>
    </PrivyProvider>
    </QueryClientProvider>
  );
}
