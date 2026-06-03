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
  if (deltaSeconds < 3600) return `${Math.max(1, Math.floor(deltaSeconds / 60))}m`;
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
  "border border-[rgba(18,18,18,0.08)] rounded-[18px] bg-[rgba(255,255,255,0.78)] shadow-[0_18px_40px_rgba(0,0,0,0.05)] backdrop-blur-[16px]";

export const chipClass =
  "inline-flex items-center min-h-[32px] px-3 rounded-full border border-[rgba(18,18,18,0.08)] bg-[rgba(255,255,255,0.88)] text-[rgba(18,18,18,0.48)] text-[11px] font-semibold tracking-[0.14em] uppercase";

export const liquidActionShellClass =
  "relative h-[52px] min-w-[210px] p-0 border-0 rounded-[14px] overflow-hidden cursor-pointer shadow-[inset_0_1px_0_rgba(255,255,255,0.88),inset_0_-1px_0_rgba(0,0,0,0.08)] transition-transform duration-[120ms] hover:-translate-y-px active:scale-[0.985]";

export const liquidActionLabelClass =
  "absolute inset-[6px] z-[2] inline-flex items-center justify-center rounded-[9px] border border-[rgba(255,255,255,0.42)] bg-[rgba(255,255,255,0.16)] px-4 text-[17px] font-medium tracking-[0.02em] !text-[#121212] [text-shadow:0_1px_0_rgba(255,255,255,0.34)] shadow-[inset_0_1px_0_rgba(255,255,255,0.34),inset_0_-1px_0_rgba(255,255,255,0.08)] backdrop-blur-[14px] pointer-events-none font-instrument whitespace-nowrap";

export const skelBase =
  "rounded-[6px] bg-gradient-to-r from-[rgba(18,18,18,0.07)] via-[rgba(18,18,18,0.13)] to-[rgba(18,18,18,0.07)] bg-[length:200%_100%] animate-skel-sweep";

export function pillClass(state: ConfluenceState) {
  return cn(
    "inline-flex items-center justify-center w-fit min-h-[28px] px-[10px] rounded-full text-[11px] font-semibold tracking-[0.14em] uppercase",
    state === "supportive" && "bg-[rgba(26,127,70,0.12)] text-[#1a7f46]",
    state === "neutral" &&
      "bg-[rgba(18,18,18,0.06)] text-[rgba(18,18,18,0.64)]",
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
    <div className="grid gap-[6px] rounded-[16px] border border-dashed border-[rgba(18,18,18,0.12)] bg-[rgba(250,250,247,0.72)] p-[16px]">
      <strong className="font-barlow text-[14px] font-semibold">{title}</strong>
      <span className="font-inter text-[14px] leading-[1.6] text-[rgba(18,18,18,0.58)]">
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
            className="text-[rgba(18,18,18,0.48)] transition-transform duration-[160ms] group-open:rotate-180"
          />
        </div>
      </summary>
      <div className="grid gap-[14px]">{children}</div>
    </details>
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
