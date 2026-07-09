"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAction } from "convex/react";
import { useQuery as useTanstackQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { api } from "@/convex/_generated/api";
import { useEcosystemWallet } from "@/components/convex-client-provider";
import {
  CELO_DEPOSIT_TOKEN_ADDRESS,
  CELO_DEPOSIT_TOKEN_DECIMALS,
  MINIMAL_ERC20_ABI,
} from "@/lib/celo/gildore-vault-celo";
import { celoUsdcBalanceKeys } from "@/lib/queries/celo-vault";
import { vaultSnapshotKeys } from "@/lib/queries/solana-vault";
import { cn } from "@/lib/utils";

const IDLE_HINT_DELAY_MS = 6_000;
const POINTER_OFFSET_X = 18;
const POINTER_OFFSET_Y = 14;

type PointerState = {
  x: number;
  y: number;
  visible: boolean;
};

function formatBalanceUi(rawValue: string, decimals: number) {
  const scale = BigInt(10) ** BigInt(decimals);
  const value = BigInt(rawValue);
  const whole = value / scale;
  const fraction = value % scale;
  const cents =
    decimals >= 2
      ? fraction / (BigInt(10) ** BigInt(decimals - 2))
      : fraction * (BigInt(10) ** BigInt(2 - decimals));
  return `${whole.toString()}.${cents.toString().padStart(2, "0")}`;
}

export function WalletBalanceCursor() {
  const eco = useEcosystemWallet();
  const getFundingTokenBalance = useAction(
    api.agentVault.getFundingTokenBalance,
  );
  const [pointer, setPointer] = useState<PointerState>({
    x: 0,
    y: 0,
    visible: false,
  });
  const [supportsFinePointer, setSupportsFinePointer] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [showBalance, setShowBalance] = useState(false);
  const idleTimerRef = useRef<number | null>(null);

  const shouldRender = supportsFinePointer && eco.isConnected && !!eco.address;

  const { data: solanaFundingTokenBalance } = useTanstackQuery({
    queryKey: vaultSnapshotKeys.fundingBalance(
      eco.ecosystem === "solana" ? (eco.address ?? "") : "",
    ),
    queryFn: () =>
      getFundingTokenBalance({
        walletAddress: eco.address!,
      }),
    enabled: shouldRender && eco.ecosystem === "solana" && !!eco.address,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const { data: rawCeloUsdcBalance } = useTanstackQuery({
    queryKey: celoUsdcBalanceKeys.balance(
      eco.ecosystem === "celo" ? (eco.address ?? "") : "",
    ),
    queryFn: async () => {
      const result = await eco.celoPublicClient.readContract({
        address: CELO_DEPOSIT_TOKEN_ADDRESS!,
        abi: MINIMAL_ERC20_ABI,
        functionName: "balanceOf",
        args: [eco.address! as `0x${string}`],
      });
      return result as bigint;
    },
    enabled:
      shouldRender &&
      eco.ecosystem === "celo" &&
      !!eco.address &&
      !!CELO_DEPOSIT_TOKEN_ADDRESS,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const balanceLabel = useMemo(() => {
    if (!shouldRender) return null;
    if (eco.ecosystem === "solana") {
      if (!solanaFundingTokenBalance) return "Loading USDC...";
      return `${formatBalanceUi(
        solanaFundingTokenBalance.balanceBaseUnits,
        solanaFundingTokenBalance.decimals,
      )} USDC`;
    }
    if (rawCeloUsdcBalance == null) {
      return "Loading USDC...";
    }
    return `${formatBalanceUi(
      rawCeloUsdcBalance.toString(),
      CELO_DEPOSIT_TOKEN_DECIMALS,
    )} USDC`;
  }, [
    eco.ecosystem,
    rawCeloUsdcBalance,
    shouldRender,
    solanaFundingTokenBalance,
  ]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(pointer: fine)");
    const reducedMotionQuery = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );

    const syncSupport = () => {
      setSupportsFinePointer(mediaQuery.matches && !reducedMotionQuery.matches);
    };

    syncSupport();
    mediaQuery.addEventListener("change", syncSupport);
    reducedMotionQuery.addEventListener("change", syncSupport);

    return () => {
      mediaQuery.removeEventListener("change", syncSupport);
      reducedMotionQuery.removeEventListener("change", syncSupport);
    };
  }, []);

  useEffect(() => {
    if (!shouldRender) {
      setShowHint(false);
      setShowBalance(false);
      return;
    }

    const clearIdleTimer = () => {
      if (idleTimerRef.current) {
        window.clearTimeout(idleTimerRef.current);
      }
    };

    const scheduleIdleHint = () => {
      clearIdleTimer();
      idleTimerRef.current = window.setTimeout(() => {
        setShowHint(true);
      }, IDLE_HINT_DELAY_MS);
    };

    const registerActivity = (event?: MouseEvent) => {
      if (event) {
        setPointer({
          x: event.clientX,
          y: event.clientY,
          visible: true,
        });
      }
      setShowHint(false);
      scheduleIdleHint();
    };

    const handleMouseMove = (event: MouseEvent) => {
      registerActivity(event);
    };

    const handleDoubleClick = (event: MouseEvent) => {
      registerActivity(event);
      setShowBalance((current) => !current);
    };

    const handleMouseLeave = () => {
      setPointer((current) => ({ ...current, visible: false }));
      setShowHint(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("dblclick", handleDoubleClick);
    document.addEventListener("mouseleave", handleMouseLeave);
    scheduleIdleHint();

    return () => {
      clearIdleTimer();
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("dblclick", handleDoubleClick);
      document.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [shouldRender]);

  if (!shouldRender || !pointer.visible || !balanceLabel) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed left-0 top-0 z-[140] hidden md:block"
      style={{
        transform: `translate3d(${pointer.x + POINTER_OFFSET_X}px, ${pointer.y + POINTER_OFFSET_Y}px, 0)`,
      }}
    >
      <div className="relative">
        <div
          className={cn(
            "absolute left-0 top-0 h-3 w-3 rounded-full border border-[rgba(255,244,214,0.72)] bg-[radial-gradient(circle_at_40%_35%,#f8edc9_0%,#d0b06c_52%,#8c6a24_100%)] shadow-[0_0_0_1px_rgba(8,10,16,0.38),0_8px_22px_rgba(0,0,0,0.34)] transition-[opacity,transform] duration-150 ease-out",
            showBalance ? "scale-75 opacity-0" : "scale-100 opacity-100",
          )}
        />

        <div
          className={cn(
            "origin-left rounded-full border border-white/12 bg-[linear-gradient(180deg,rgba(16,17,21,0.96),rgba(8,9,13,0.94))] px-3 py-2 shadow-[0_16px_34px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl transition-[opacity,transform] duration-200 ease-out",
            showBalance
              ? "translate-y-0 scale-100 opacity-100"
              : "translate-y-0 scale-x-[0.16] scale-y-[0.82] opacity-0",
          )}
        >
          <span className="flex items-center gap-2 whitespace-nowrap font-barlow text-[11px] font-semibold uppercase tracking-[0.14em] text-white/88">
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[linear-gradient(180deg,#f6e7be,#b58a3b)] px-1.5 text-[10px] text-[#16110a] shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
              $
            </span>
            {balanceLabel}
          </span>
        </div>

        <div
          className={cn(
            "absolute left-5 top-[-2px] rounded-md flex items-center justify-center border border-white/10 bg-[rgba(13,14,18,0.94)] px-3 py-1.5 shadow-[0_12px_28px_rgba(0,0,0,0.26)] backdrop-blur-lg transition-[opacity,transform] duration-150 ease-out",
            showHint && !showBalance
              ? "translate-y-0 opacity-100"
              : "translate-y-1 opacity-0",
          )}
        >
          <span className="whitespace-nowrap font-barlow text-[10px] font-semibold uppercase tracking-[0.14em] text-white/64">
            Double tap to view balance
          </span>
        </div>
      </div>
    </div>
  );
}
