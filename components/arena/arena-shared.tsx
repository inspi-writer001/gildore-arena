"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { LiquidMetal } from "@paper-design/shaders-react";
import { cn } from "@/lib/utils";
import type { ConfluenceState } from "@/lib/arena-types";

export const statusLabelMap = {
  scanning: "Scanning",
  watchlist: "Watchlist",
  ready: "Ready",
  entered: "Entered",
  monitoring: "Monitoring",
  closed: "Closed",
} as const;

export const confluenceToneMap = {
  supportive: "Supportive",
  neutral: "Neutral",
  risk: "Risk",
} as const;

export const browserSessionStatusLabelMap = {
  starting: "Starting",
  loading_chart: "Loading chart",
  switching_symbol: "Switching symbol",
  switching_timeframe: "Switching timeframe",
  ready: "Ready",
  failed: "Failed",
  completed: "Completed",
} as const;

export function formatRelativeMinutes(timestamp: number | null) {
  if (!timestamp) return "Not yet run";

  const deltaSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}m ago`;
  return `${Math.floor(deltaSeconds / 3600)}h ago`;
}

function formatFreshness(timestamp: number | null, staleLabel: string) {
  if (!timestamp) return staleLabel;
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (deltaSeconds < 3600)
    return `${Math.max(1, Math.floor(deltaSeconds / 60))}m`;
  if (deltaSeconds < 86400) return `${Math.floor(deltaSeconds / 3600)}h`;
  return `${Math.floor(deltaSeconds / 86400)}d`;
}

export function formatSyncFreshness(timestamp: number | null) {
  return formatFreshness(timestamp, "stale");
}

export function formatReviewFreshness(timestamp: number | null) {
  return formatFreshness(timestamp, "not reviewed");
}

export function formatEventTimeLabel(timestampSec?: number) {
  if (!timestampSec) return "";

  return new Date(timestampSec * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const surfaceCard =
  "rounded-[18px] border border-white/10 bg-[linear-gradient(180deg,rgba(26,26,29,0.94),rgba(16,16,18,0.98))] shadow-[0_24px_60px_rgba(0,0,0,0.38)] backdrop-blur-[16px]";

export const mainsurfaceCard =
  "";

export const chipClass =
  "inline-flex min-h-[32px] items-center rounded-full border border-white/10 bg-white/[0.05] px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgba(245,245,245,0.72)]";

export const liquidActionShellClass =
  "relative h-[52px] min-w-[210px] p-0 border-0 rounded-[14px] overflow-hidden cursor-pointer shadow-[inset_0_1px_0_rgba(255,255,255,0.88),inset_0_-1px_0_rgba(0,0,0,0.08)] transition-transform duration-[120ms] hover:-translate-y-px active:scale-[0.985]";

export const liquidActionLabelClass =
  "absolute inset-[6px] z-[2] inline-flex items-center justify-center rounded-[9px] border border-[rgba(255,255,255,0.42)] bg-[rgba(255,255,255,0.16)] px-4 text-[17px] font-medium tracking-[0.02em] !text-[#121212] [text-shadow:0_1px_0_rgba(255,255,255,0.34)] shadow-[inset_0_1px_0_rgba(255,255,255,0.34),inset_0_-1px_0_rgba(255,255,255,0.08)] backdrop-blur-[14px] pointer-events-none font-instrument whitespace-nowrap";

export const skelBase =
  "animate-skel-sweep rounded-[6px] bg-gradient-to-r from-[rgba(255,255,255,0.06)] via-[rgba(255,255,255,0.13)] to-[rgba(255,255,255,0.06)] bg-[length:200%_100%]";

export function pillClass(state: ConfluenceState) {
  return cn(
    "inline-flex items-center justify-center w-fit min-h-[28px] px-[10px] rounded-full text-[11px] font-semibold tracking-[0.14em] uppercase",
    state === "supportive" && "bg-[rgba(26,127,70,0.12)] text-[#1a7f46]",
    state === "neutral" && "bg-white/[0.08] text-[rgba(245,245,245,0.72)]",
    state === "risk" && "bg-[rgba(163,48,48,0.12)] text-[#a33030]",
  );
}

export function truncateWalletAddress(address: string) {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function formatUnknownError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "cause" in error &&
    typeof error.cause === "string"
  ) {
    return error.cause;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "err" in error &&
    error.err !== null &&
    error.err !== undefined
  ) {
    return formatUnknownError(error.err);
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "logs" in error &&
    Array.isArray(error.logs) &&
    error.logs.length > 0
  ) {
    return error.logs.join(" | ");
  }

  try {
    const serialized = JSON.stringify(error, null, 2);
    return serialized === undefined ? String(error) : serialized;
  } catch {
    return String(error);
  }
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="grid gap-[6px] rounded-[16px] border border-dashed border-white/12 bg-white/[0.04] p-[16px]">
      <strong className="font-barlow text-[14px] font-semibold text-[#f5f5f5]">
        {title}
      </strong>
      <span className="font-inter text-[14px] leading-[1.6] text-[rgba(245,245,245,0.62)]">
        {description}
      </span>
    </div>
  );
}

export function DisclosureSection({
  title,
  icon,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: ReactNode;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="group grid gap-0 open:gap-[14px]" open={defaultOpen}>
      <summary className="flex list-none items-center justify-between gap-3 cursor-pointer [&::-webkit-details-marker]:hidden">
        <div className="flex items-center gap-[10px]">
          {icon}
          <h2 className="m-0 font-barlow text-[14px] font-semibold tracking-[0.06em] uppercase">
            {title}
          </h2>
        </div>
        <div className="inline-flex items-center gap-[10px]">
          {badge}
          <ChevronDown
            aria-hidden="true"
            size={16}
            className="text-[rgba(245,245,245,0.48)] transition-transform duration-[160ms] group-open:rotate-180"
          />
        </div>
      </summary>
      <div className="grid gap-[14px]">{children}</div>
    </details>
  );
}

export function SolidActionButton({
  label,
  onClick,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex min-h-[52px] min-w-[210px] items-center justify-center rounded-[14px] border border-white/10 bg-[#f5f5f5] px-5 font-instrument text-[17px] font-medium tracking-[0.02em] text-[#121212] shadow-[0_16px_36px_rgba(0,0,0,0.24)] transition-[transform,background-color] duration-[120ms] hover:-translate-y-px hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b0d] active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {label}
    </button>
  );
}

export function LiquidActionButton({
  label,
  onClick,
  colorBack,
  colorTint,
  type = "button",
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  colorBack: string;
  colorTint: string;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={cn(
        liquidActionShellClass,
        "bg-[#f5f5f2] disabled:cursor-not-allowed disabled:opacity-60",
      )}
      onClick={onClick}
    >
      <LiquidMetal
        className="!absolute inset-0 !h-full !w-full pointer-events-none"
        colorBack={colorBack}
        colorTint={colorTint}
        shape="none"
        repetition={2.6}
        softness={0.12}
        shiftRed={0.18}
        shiftBlue={0.22}
        distortion={0.08}
        contour={0.52}
        angle={70}
        speed={1}
        scale={1}
        fit="cover"
        width="100%"
        height="100%"
      />
      <span className={liquidActionLabelClass}>{label}</span>
    </button>
  );
}
