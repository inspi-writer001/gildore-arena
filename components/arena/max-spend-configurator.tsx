"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function MaxSpendConfigurator({
  marketSymbol,
  spendAmount,
  onSpendAmountChange,
  onSubmit,
  isConfiguring,
  isConnected,
  error,
  lastSignature,
}: {
  marketSymbol: string;
  spendAmount: string;
  onSpendAmountChange: (value: string) => void;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
  isConfiguring: boolean;
  isConnected: boolean;
  error: string | null;
  lastSignature: string | null;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="grid gap-4 rounded-[18px] border border-[rgba(18,18,18,0.08)] bg-[rgba(255,255,255,0.78)] p-5 shadow-[0_18px_40px_rgba(0,0,0,0.05)] backdrop-blur-[16px]">
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        className="flex items-center justify-between gap-3 text-left"
      >
        <div className="grid gap-1">
          <h3 className="m-0 font-barlow text-[15px] font-semibold">
            Configure max spendable for {marketSymbol}
          </h3>
        </div>
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-[rgba(18,18,18,0.08)] bg-[rgba(250,250,247,0.9)] text-[rgba(18,18,18,0.54)] transition hover:bg-[rgba(255,255,255,0.98)]">
          <ChevronDown
            aria-hidden="true"
            size={16}
            className={cn("transition-transform", isOpen && "rotate-180")}
          />
        </span>
      </button>

      {isOpen ? (
        <form className="grid gap-4" onSubmit={onSubmit}>
          <p className="m-0 max-w-[58ch] font-inter text-[13px] leading-[1.6] text-[rgba(18,18,18,0.6)]">
            Set the maximum amount this agent can spend from your vault while
            trading the currently selected market.
          </p>
          <div className="grid gap-2">
            <label
              htmlFor="max-spend-amount"
              className="font-barlow text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgba(18,18,18,0.46)]"
            >
              Max spendable amount
            </label>
            <input
              id="max-spend-amount"
              type="text"
              inputMode="decimal"
              value={spendAmount}
              onChange={(event) => onSpendAmountChange(event.target.value)}
              placeholder="0.00"
              className="h-[58px] rounded-[16px] border border-[rgba(18,18,18,0.08)] bg-[rgba(250,250,247,0.9)] px-4 font-instrument text-[28px] font-normal text-[#121212] outline-none transition placeholder:text-[rgba(18,18,18,0.2)] focus:border-[rgba(18,18,18,0.22)] focus:bg-[rgba(255,255,255,0.98)]"
            />
          </div>

          {!isConnected ? (
            <p className="m-0 rounded-[14px] border border-[rgba(18,18,18,0.08)] bg-[rgba(250,250,247,0.9)] px-4 py-3 font-inter text-[13px] leading-[1.6] text-[rgba(18,18,18,0.6)]">
              Connect your wallet before configuring max spendable.
            </p>
          ) : null}

          {error ? (
            <p className="m-0 rounded-[14px] border border-[rgba(163,48,48,0.16)] bg-[rgba(251,238,236,0.84)] px-4 py-3 font-inter text-[13px] leading-[1.6] text-[#8a2d2d]">
              {error}
            </p>
          ) : null}

          {lastSignature ? (
            <p className="m-0 rounded-[14px] border border-[rgba(18,18,18,0.08)] bg-[rgba(250,250,247,0.9)] px-4 py-3 font-inter text-[13px] leading-[1.6] text-[rgba(18,18,18,0.6)]">
              Last allocation signature:{" "}
              <span className="font-mono text-[12px] text-[#121212]">
                {lastSignature.slice(0, 18)}...
              </span>
            </p>
          ) : null}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isConfiguring || !isConnected}
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-[rgba(18,18,18,0.14)] bg-[linear-gradient(180deg,rgba(20,18,16,0.96),rgba(8,8,8,0.98))] px-5 font-barlow text-[11px] font-semibold uppercase tracking-[0.14em] text-[#f7efe7] shadow-[0_12px_30px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.08)] transition hover:bg-[linear-gradient(180deg,rgba(28,26,24,0.98),rgba(10,10,10,1))] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isConfiguring ? "Configuring..." : "Set max spendable"}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
