"use client";

import { ChevronDown, LogOut, Wallet } from "lucide-react";
import { useState } from "react";
import { useSolanaWallet } from "@/components/convex-client-provider";
import { cn } from "@/lib/utils";
import { truncateWalletAddress } from "@/components/arena/arena-shared";

export function SignInCard() {
  const {
    ready,
    isAuthenticated,
    selectedWallet,
    selectedAccount,
    userEmail,
    isConnected,
    login,
    logout,
  } = useSolanaWallet();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  return (
    <div className="grid w-full gap-3 rounded-[18px] border border-[#744729] bg-[#8d5c39] p-[18px] text-left text-[#f7efe7] shadow-[0_20px_45px_rgba(97,55,26,0.24)] sm:min-w-[280px] lg:min-w-[340px]">
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        className="grid gap-2 text-left"
      >
        <span className="font-barlow text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgba(247,239,231,0.72)]">
          Solana
        </span>
        <span className="flex items-center justify-between gap-3">
          <strong className="font-instrument text-[32px] font-normal leading-[0.95]">
            {isConnected && selectedAccount
              ? truncateWalletAddress(selectedAccount.address)
              : "Sign in"}
          </strong>
          <span className="flex items-center gap-2 text-[rgba(247,239,231,0.84)]">
            <Wallet aria-hidden="true" size={16} />
            <ChevronDown
              aria-hidden="true"
              size={16}
              className={cn("transition", isOpen && "rotate-180")}
            />
          </span>
        </span>
      </button>

      {isOpen ? (
        <div className="grid gap-3 rounded-[14px] border border-[rgba(255,255,255,0.16)] bg-[rgba(58,32,16,0.18)] p-3">
          {isConnected && selectedWallet && selectedAccount ? (
            <>
              <div className="grid gap-1">
                <span className="font-barlow text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgba(247,239,231,0.68)]">
                  Connected
                </span>
                <span className="font-barlow text-[14px] font-semibold tracking-[0.04em] text-[#f7efe7]">
                  {selectedWallet.standardWallet.name}
                </span>
                <span className="font-mono text-[12px] text-[rgba(247,239,231,0.78)]">
                  {selectedAccount.address}
                </span>
                {userEmail ? (
                  <span className="font-barlow text-[12px] text-[rgba(247,239,231,0.68)]">
                    {userEmail}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      setIsLoggingOut(true);
                      await logout();
                      setIsOpen(false);
                    } catch (error) {
                      console.error("Failed to disconnect Privy wallet", error);
                    } finally {
                      setIsLoggingOut(false);
                    }
                  }}
                  disabled={isLoggingOut}
                  className="inline-flex items-center gap-2 rounded-full border border-[rgba(255,255,255,0.18)] px-3 py-1.5 font-barlow text-[11px] font-semibold uppercase tracking-[0.14em] text-[#f7efe7] transition hover:bg-[rgba(255,255,255,0.08)] disabled:cursor-wait disabled:opacity-70"
                >
                  <LogOut size={14} aria-hidden="true" />
                  {isLoggingOut ? "Disconnecting" : "Disconnect"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="inline-flex items-center rounded-full border border-[rgba(255,255,255,0.18)] px-3 py-1.5 font-barlow text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgba(247,239,231,0.72)] transition hover:bg-[rgba(255,255,255,0.08)]"
                >
                  Close
                </button>
              </div>
            </>
          ) : ready ? (
            <>
              <p className="font-barlow text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgba(247,239,231,0.68)]">
                Trader Vault
              </p>
              <button
                type="button"
                onClick={() => {
                  login();
                  setIsOpen(false);
                }}
                className="flex w-full items-center justify-between rounded-[14px] border border-[rgba(255,255,255,0.16)] bg-[rgba(255,255,255,0.08)] px-3 py-2 text-left transition hover:bg-[rgba(255,255,255,0.14)]"
              >
                <span className="flex items-center gap-2">
                  <span className="flex size-8 items-center justify-center rounded-full bg-[rgba(255,255,255,0.16)] text-[11px] font-semibold uppercase text-[#f7efe7]">
                    PR
                  </span>
                  <span className="font-barlow text-[13px] font-semibold tracking-[0.04em] text-[#f7efe7]">
                    {isAuthenticated
                      ? "Finish wallet setup"
                      : "Continue with Privy"}
                  </span>
                </span>
                <span className="font-barlow text-[11px] uppercase tracking-[0.14em] text-[rgba(247,239,231,0.72)]">
                  Enter
                </span>
              </button>
              <p className="font-barlow text-[12px] leading-5 text-[rgba(247,239,231,0.72)]">
                Privy will create an embedded Solana wallet for agent funding.
              </p>
            </>
          ) : (
            <p className="font-barlow text-[12px] leading-5 text-[rgba(247,239,231,0.8)]">
              Initializing Privy and your Solana wallet context.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
