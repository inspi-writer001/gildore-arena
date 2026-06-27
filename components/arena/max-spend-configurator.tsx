"use client";

import { useMemo } from "react";
import { Slider } from "@/components/ui/slider";

const MIN_SPENDABLE = 0;
const MAX_SPENDABLE = 1_000;
const SPENDABLE_STEP = 5;

function clampSpendable(value: number) {
  return Math.min(MAX_SPENDABLE, Math.max(MIN_SPENDABLE, value));
}

function formatSpendable(value: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function MaxSpendConfigurator({
  marketSymbol,
  spendAmount,
  onSpendAmountChange,
  onSubmit,
  isConfiguring,
  isConnected,
  error,
  lastSignature,
  compact = false,
}: {
  marketSymbol: string;
  spendAmount: string;
  onSpendAmountChange: (value: string) => void;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
  isConfiguring: boolean;
  isConnected: boolean;
  error: string | null;
  lastSignature: string | null;
  compact?: boolean;
}) {
  const sliderValue = useMemo(() => {
    const parsedAmount = Number.parseFloat(spendAmount);
    if (Number.isFinite(parsedAmount)) {
      return clampSpendable(parsedAmount);
    }
    return 250;
  }, [spendAmount]);

  return (
    <form
      className={compact
        ? "flex flex-col justify-evenly gap-3"
        : "flex flex-col justify-evenly h-[120px] rounded-[16px] border border-[rgba(18,18,18,0.08)] bg-[rgba(250,250,247,0.92)] p-[14px] shadow-[0_18px_40px_rgba(0,0,0,0.05)]"
      }
      onSubmit={onSubmit}
    >
      <div className="flex items-start justify-between">
        <div className="grid gap-1">
          <span className="font-barlow text-[10px] font-semibold uppercase tracking-[0.14em] text-[rgba(18,18,18,0.42)]">
            Max spend for {marketSymbol}
          </span>
        </div>
      </div>

      <div className="flex flex-col">
        <Slider
          value={[sliderValue]}
          min={MIN_SPENDABLE}
          max={MAX_SPENDABLE}
          step={SPENDABLE_STEP}
          onValueChange={(values) => {
            const nextValue = values[0];
            if (typeof nextValue === "number") {
              onSpendAmountChange(String(nextValue));
            }
          }}
          aria-label={`Max spendable amount for ${marketSymbol}`}
        />
        <div className="flex items-center justify-between font-barlow text-[10px] font-semibold uppercase tracking-[0.12em] text-[rgba(18,18,18,0.42)]">
          <span>{formatSpendable(MIN_SPENDABLE)}</span>
          <span>{formatSpendable(MAX_SPENDABLE)}</span>
        </div>
      </div>

      <div className="__full_width flex flex-row items-center w-full justify-between">
        <div className="font-instrument text-[26px] leading-none text-[#121212]">
          ${formatSpendable(sliderValue)}
        </div>

        <button
          type="submit"
          disabled={isConfiguring || !isConnected}
          className=" inline-flex min-h-[38px] items-center justify-center rounded-[12px] border border-[rgba(18,18,18,0.14)] bg-[linear-gradient(180deg,rgba(20,18,16,0.96),rgba(8,8,8,0.98))] px-4 font-barlow text-[10px] font-semibold uppercase tracking-[0.14em] text-[#f7efe7] hover:cursor-pointer transition hover:bg-[linear-gradient(180deg,rgba(28,26,24,0.9),rgba(10,10,10,1))] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isConfiguring ? "Applying..." : "Apply"}
        </button>
      </div>
    </form>
  );
}
