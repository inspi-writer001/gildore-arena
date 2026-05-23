"use client";

import { Check, ChevronDown, Copy, LogOut, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { useSolanaWallet } from "@/components/convex-client-provider";
import { cn } from "@/lib/utils";

function truncateBetween(
  value: string,
  leadingChars = 9,
  trailingChars = 3,
) {
  if (value.length <= leadingChars + trailingChars + 2) {
    return value;
  }

  return `${value.slice(0, leadingChars)}...${value.slice(-trailingChars)}`;
}

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
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => {
    if (!isCopied) return;

    const timeoutId = window.setTimeout(() => {
      setIsCopied(false);
    }, 3000);

    return () => window.clearTimeout(timeoutId);
  }, [isCopied]);

  return (
    <div className="relative w-full min-w-0 sm:min-w-[280px] lg:min-w-[340px]">
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        className="flex w-full min-w-0 flex-col gap-2 overflow-hidden rounded-[20px] border border-[rgba(18,18,18,0.14)] bg-[linear-gradient(180deg,rgba(20,18,16,0.96),rgba(8,8,8,0.98))] px-5 py-4 text-left text-[#f7efe7] shadow-[0_20px_45px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.08)]"
      >
        <div className="flex min-w-0 items-center justify-between gap-3">
          <span className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
            <strong className="block min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-instrument text-[32px] font-normal leading-[0.95] text-[#fff7ea]">
              {isConnected && selectedAccount
                ? truncateBetween(selectedAccount.address, 9, 3)
                : "Sign in"}
            </strong>
          </span>
          <span className="flex shrink-0 items-center gap-2 rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-3 py-2 text-[rgba(247,239,231,0.84)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <Wallet aria-hidden="true" size={15} />
            <ChevronDown
              aria-hidden="true"
              size={16}
              className={cn("transition", isOpen && "rotate-180")}
            />
          </span>
        </div>
      </button>

      {isOpen ? (
        <div className="absolute top-full right-0 left-0 z-30 mt-3 grid w-full gap-3 rounded-[20px] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(15,14,13,0.98),rgba(7,7,7,0.98))] p-4 text-[#f7efe7] shadow-[0_22px_60px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.03)]">
          {isConnected && selectedWallet && selectedAccount ? (
            <>
              <div className="grid gap-1">
                <span className="font-barlow text-[14px] font-semibold tracking-[0.04em] text-[#fff7ea]">
                  Connected via {selectedWallet.standardWallet.name}
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[12px] text-[rgba(247,239,231,0.78)]">
                    {truncateBetween(selectedAccount.address, 9, 3)}
                  </span>
                  <button
                    type="button"
                    aria-label={
                      isCopied ? "Wallet address copied" : "Copy wallet address"
                    }
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          selectedAccount.address,
                        );
                        setIsCopied(true);
                      } catch (error) {
                        console.error("Failed to copy wallet address", error);
                      }
                    }}
                    className="inline-flex size-6 items-center justify-center rounded-full border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)] text-[rgba(247,239,231,0.72)] transition hover:bg-[rgba(255,255,255,0.1)] hover:text-[#fff7ea]"
                  >
                    {isCopied ? (
                      <Check aria-hidden="true" size={12} />
                    ) : (
                      <Copy aria-hidden="true" size={12} />
                    )}
                  </button>
                </div>
                {userEmail ? (
                  <span className="font-barlow text-[12px] text-[rgba(247,239,231,0.56)]">
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
                  className="inline-flex items-center gap-2 rounded-full border border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.04)] px-3 py-1.5 font-barlow text-[11px] font-semibold uppercase tracking-[0.14em] text-[#f7efe7] transition hover:bg-[rgba(255,255,255,0.1)] disabled:cursor-wait disabled:opacity-70"
                >
                  <LogOut size={14} aria-hidden="true" />
                  {isLoggingOut ? "Disconnecting" : "Disconnect"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="inline-flex items-center rounded-full border border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.03)] px-3 py-1.5 font-barlow text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgba(247,239,231,0.72)] transition hover:bg-[rgba(255,255,255,0.1)]"
                >
                  Close
                </button>
              </div>
            </>
          ) : ready ? (
            <>
              <p className="font-barlow text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgba(247,239,231,0.5)]">
                Trader Vault
              </p>
              <button
                type="button"
                onClick={() => {
                  login();
                  setIsOpen(false);
                }}
                className="flex w-full items-center justify-between rounded-[14px] border border-[rgba(255,255,255,0.12)] bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.04))] px-3 py-2 text-left transition hover:bg-[rgba(255,255,255,0.14)]"
              >
                <span className="flex items-center gap-2">
                  <span className="flex size-8 items-center justify-center rounded-full bg-[rgba(255,255,255,0.12)] text-[11px] font-semibold uppercase text-[#f7efe7]">
                    PR
                  </span>
                  <span className="font-barlow text-[13px] font-semibold tracking-[0.04em] text-[#fff7ea]">
                    {isAuthenticated
                      ? "Finish wallet setup"
                      : "Continue with Privy"}
                  </span>
                </span>
                <span className="font-barlow text-[11px] uppercase tracking-[0.14em] text-[rgba(247,239,231,0.72)]">
                  Enter
                </span>
              </button>
              <p className="font-barlow text-[12px] leading-5 text-[rgba(247,239,231,0.62)]">
                Privy will create an embedded Solana wallet for agent funding.
              </p>
            </>
          ) : (
            <p className="font-barlow text-[12px] leading-5 text-[rgba(247,239,231,0.72)]">
              Initializing Privy and your Solana wallet context.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
