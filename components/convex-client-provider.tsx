"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
} from "@solana/kit";
import {
  PrivyProvider,
  useLogin,
  useLogout,
  usePrivy,
} from "@privy-io/react-auth";
import {
  useWallets,
  type ConnectedStandardSolanaWallet,
} from "@privy-io/react-auth/solana";

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
const solanaRpc = createSolanaRpc(
  solanaRpcUrl as Parameters<typeof createSolanaRpc>[0],
);
const solanaRpcSubscriptions = createSolanaRpcSubscriptions(
  solanaSubscriptionsUrl as Parameters<typeof createSolanaRpcSubscriptions>[0],
);

export type SolanaWalletState = {
  rpc: typeof solanaRpc;
  rpcSubscriptions: typeof solanaRpcSubscriptions;
  chain: typeof solanaChain;
  ready: boolean;
  isAuthenticated: boolean;
  isConnected: boolean;
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
    <PrivyProvider
      appId={privyAppId}
      clientId={privyClientId}
      config={{
        appearance: {
          theme: "dark",
          walletChainType: "solana-only",
          landingHeader: "Enter Gildore Arena",
          loginMessage: "Create your embedded Solana vault wallet to fund agents.",
          showWalletLoginFirst: false,
        },
        embeddedWallets: {
          solana: {
            createOnLogin: "users-without-wallets",
          },
        },
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
  );
}
