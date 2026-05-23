"use client";

import { LiquidActionButton } from "@/components/arena/arena-shared";

export function AgentFundingModal({
  agentName,
  agentStatus,
  isOpen,
  isConnected,
  depositAmount,
  fundingError,
  lastFundingSignature,
  isFundingAgent,
  onClose,
  onDepositAmountChange,
  onSubmit,
}: {
  agentName: string;
  agentStatus: string;
  isOpen: boolean;
  isConnected: boolean;
  depositAmount: string;
  fundingError: string | null;
  lastFundingSignature: string | null;
  isFundingAgent: boolean;
  onClose: () => void;
  onDepositAmountChange: (value: string) => void;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-5 py-8">
      <button
        type="button"
        aria-label="Close subscribe modal"
        className="absolute inset-0 bg-[rgba(10,8,4,0.52)] backdrop-blur-[12px]"
        onClick={onClose}
      />
      <div className="relative z-[1] w-full max-w-[540px] overflow-hidden rounded-[28px] border border-[rgba(255,236,176,0.22)] bg-[#120d08] shadow-[0_32px_90px_rgba(0,0,0,0.46)]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[140px] bg-[radial-gradient(circle_at_top,rgba(255,214,120,0.34),transparent_70%)]" />
        <div className="relative grid gap-6 p-6 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div className="grid gap-2">
              <span className="w-fit rounded-full border border-[rgba(255,223,153,0.18)] bg-[rgba(255,214,120,0.12)] px-3 py-1 font-barlow text-[11px] font-semibold uppercase tracking-[0.16em] text-[#f3d48d]">
                Trader vault
              </span>
              <div>
                <h3 className="m-0 font-instrument text-[34px] font-normal leading-[0.92] text-[#fff5de]">
                  Fund {agentName}
                </h3>
                <p className="mt-3 mb-0 max-w-[42ch] font-inter text-[14px] leading-[1.65] text-[rgba(255,245,222,0.68)]">
                  Fund this trader with a clean deposit amount and enter their
                  next trade in the arena&apos;s high-conviction competition.
                </p>
              </div>
            </div>
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[rgba(255,223,153,0.16)] bg-[rgba(255,255,255,0.04)] font-barlow text-[12px] font-semibold uppercase tracking-[0.1em] text-[rgba(255,245,222,0.72)] transition hover:bg-[rgba(255,255,255,0.08)]"
              onClick={onClose}
            >
              x
            </button>
          </div>

          <form className="grid gap-5" onSubmit={onSubmit}>
            <div className="grid gap-2">
              <label
                htmlFor="subscribe-deposit-amount"
                className="font-barlow text-[11px] font-semibold uppercase tracking-[0.16em] text-[rgba(255,232,188,0.62)]"
              >
                Deposit amount
              </label>
              <div className="grid gap-3 rounded-[22px] border border-[rgba(255,223,153,0.12)] bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-barlow text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgba(255,232,188,0.45)]">
                    Configured token
                  </span>
                  <span className="font-inter text-[13px] text-[rgba(255,245,222,0.42)]">
                    Live vault preview
                  </span>
                </div>
                <input
                  id="subscribe-deposit-amount"
                  type="text"
                  inputMode="decimal"
                  value={depositAmount}
                  onChange={(event) => onDepositAmountChange(event.target.value)}
                  placeholder="0.00"
                  className="h-[76px] rounded-[18px] border border-[rgba(255,223,153,0.1)] bg-[rgba(7,5,3,0.56)] px-5 font-instrument text-[36px] font-normal text-[#fff3d7] outline-none transition placeholder:text-[rgba(255,245,222,0.18)] focus:border-[rgba(255,223,153,0.34)] focus:bg-[rgba(13,9,5,0.82)]"
                />
                <p className="m-0 font-inter text-[13px] leading-[1.6] text-[rgba(255,245,222,0.46)]">
                  This funds your personal vault for {agentName}. Trade
                  allocation for a specific ticker will be configured separately
                  after deposit.
                </p>
              </div>
            </div>

            {!isConnected ? (
              <p className="m-0 rounded-[16px] border border-[rgba(255,223,153,0.12)] bg-[rgba(255,255,255,0.04)] px-4 py-3 font-inter text-[13px] leading-[1.6] text-[rgba(255,245,222,0.62)]">
                Connect a Solana wallet before funding this agent.
              </p>
            ) : null}

            {fundingError ? (
              <p className="m-0 rounded-[16px] border border-[rgba(255,138,138,0.18)] bg-[rgba(120,24,24,0.18)] px-4 py-3 font-inter text-[13px] leading-[1.6] text-[#ffd3d3]">
                {fundingError}
              </p>
            ) : null}

            {lastFundingSignature ? (
              <p className="m-0 rounded-[16px] border border-[rgba(255,223,153,0.12)] bg-[rgba(255,255,255,0.04)] px-4 py-3 font-inter text-[13px] leading-[1.6] text-[rgba(255,245,222,0.62)]">
                Last funding signature:{" "}
                <span className="font-mono text-[12px] text-[#fff3d7]">
                  {lastFundingSignature.slice(0, 18)}...
                </span>
              </p>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="font-barlow text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgba(255,232,188,0.45)]">
                Trader status · {agentStatus}
              </span>
              <LiquidActionButton
                label={isFundingAgent ? "Funding..." : "Deposit"}
                colorBack="#9a6f26"
                colorTint="#ffe9a8"
                type="submit"
                disabled={isFundingAgent || !isConnected}
                onClick={() => {}}
              />
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
