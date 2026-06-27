"use client";

import {
  Activity,
  Eye,
  ExternalLink,
  Newspaper,
  Radar,
  TrendingDown,
  TrendingUp,
  Minus,
} from "lucide-react";
import { ImageDithering, LiquidMetal } from "@paper-design/shaders-react";
import { BrowserSessionViewport } from "@/components/arena/browser-session-viewport";
import {
  chipClass,
  confluenceToneMap,
  DisclosureSection,
  EmptyState,
  formatReviewFreshness,
  formatSyncFreshness,
  LiquidActionButton,
  pillClass,
  surfaceCard,
} from "@/components/arena/arena-shared";
import { MaxSpendConfigurator } from "@/components/arena/max-spend-configurator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type {
  ActiveStrategySetup,
  BrowserSession,
  BrowserSessionEvent,
  ConfluenceState,
  Position,
  TradeEvent,
  TradeIdea,
  TradeTimeframe,
  VisualTrace,
  WatchlistItem,
} from "@/lib/arena-types";

type SelectedAgent = {
  id: string;
  name: string;
  status:
    | "scanning"
    | "watchlist"
    | "ready"
    | "entered"
    | "monitoring"
    | "closed";
  timeframe: TradeTimeframe;
  winRate: number;
  pnlPercent: number;
  openPositions: number;
  score?: number;
  lastAction: string;
};

type TrackedMarket = {
  symbol: string;
  newsState: ConfluenceState;
  newsUpdatedAt: number | null;
  marketSyncStatus?: "seeded" | "live" | "failed" | "no_data" | null;
};

type SelectedNewsContext = {
  id: string;
  marketSymbol: string;
  headline: string;
  state: ConfluenceState;
  sourceLabel: string;
  publishedAt: string;
  note: string;
  url: string;
};

type SelectedVisionDecision = {
  regime: "bullish" | "bearish" | "mixed";
  verdict: "valid" | "staged" | "invalid" | "reject";
  structureVerdict: "drawable" | "watch_future_touch" | "broken" | "none";
  direction: "long" | "short" | "none";
  structureStatus: "clean" | "weak" | "broken" | "none";
  confidence: number;
  correctedT1?: { price: number; note: string } | null;
  correctedT2?: { price: number; note: string } | null;
  correctedZone?: {
    low: number;
    high: number;
    projectedPrice: number;
  } | null;
  invalidationZone?: {
    low: number;
    high: number;
    note: string;
  } | null;
  invalidationNote?: string | null;
  rationale: string;
  issues: string[];
};

const disclosureScrollViewportClass =
  "max-h-[360px] overflow-y-auto pr-2 [scrollbar-width:thin]";

const newsToneDot: Record<ConfluenceState, string> = {
  supportive: "bg-[#4caf7d]",
  neutral: "bg-[rgba(18,18,18,0.28)]",
  risk: "bg-[#e06060]",
};

function formatVaultAmount(raw: string | null, decimals: number): string {
  if (raw == null) return "—";
  const n = Number(BigInt(raw)) / 10 ** decimals;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Vault control surface ─────────────────────────────────────────────────────

type VaultControlSurfaceProps = {
  // vault stats
  vaultBalance: string | null;
  vaultAllowance: string | null;
  isInPosition: boolean | null;
  vaultDecimals: number;
  isLoadingVault: boolean;
  // market & max spend
  marketSymbol: string;
  spendAmount: string;
  onSpendAmountChange: (value: string) => void;
  onSubmitMaxSpend: React.FormEventHandler<HTMLFormElement>;
  isConfiguringMaxSpend: boolean;
  maxSpendError: string | null;
  lastMaxSpendSignature: string | null;
  isConnected: boolean;
  // withdraw
  withdrawAmount: string;
  onWithdrawAmountChange: (value: string) => void;
  onSubmitWithdraw: React.FormEventHandler<HTMLFormElement>;
  isWithdrawing: boolean;
  withdrawError: string | null;
  lastWithdrawSignature: string | null;
  // position actions
  onClosePosition: () => void;
  isClosingPosition: boolean;
  onOpenPrediction: () => void;
  // performance
  pnlPercent: number;
  winRate: number;
  openPositions: number;
};

function VaultStatCell({
  label,
  value,
  loading,
  accent,
}: {
  label: string;
  value: string;
  loading: boolean;
  accent?: "positive" | "negative" | "active" | null;
}) {
  return (
    <div className="grid gap-[5px]">
      <span className="font-barlow text-[10px] font-semibold uppercase tracking-[0.14em] text-[rgba(18,18,18,0.42)]">
        {label}
      </span>
      {loading ? (
        <div className="h-[28px] w-[64px] animate-pulse rounded-[6px] bg-[rgba(18,18,18,0.06)]" />
      ) : (
        <span
          className={cn(
            "font-instrument text-[22px] leading-none",
            accent === "positive" && "text-[#2e7d52]",
            accent === "negative" && "text-[#8a2d2d]",
            accent === "active" && "text-[#5c3d8f]",
            (!accent || accent === null) && "text-[#121212]",
          )}
        >
          {value}
        </span>
      )}
    </div>
  );
}

function VaultControlSurface({
  vaultBalance,
  vaultAllowance,
  isInPosition,
  vaultDecimals,
  isLoadingVault,
  marketSymbol,
  spendAmount,
  onSpendAmountChange,
  onSubmitMaxSpend,
  isConfiguringMaxSpend,
  maxSpendError,
  lastMaxSpendSignature,
  isConnected,
  withdrawAmount,
  onWithdrawAmountChange,
  onSubmitWithdraw,
  isWithdrawing,
  withdrawError,
  lastWithdrawSignature,
  onClosePosition,
  isClosingPosition,
  onOpenPrediction,
  pnlPercent,
  winRate,
  openPositions,
}: VaultControlSurfaceProps) {
  const formattedBalance = formatVaultAmount(vaultBalance, vaultDecimals);
  const formattedAllowance = formatVaultAmount(vaultAllowance, vaultDecimals);

  const positionLabel =
    isInPosition == null ? "—" : isInPosition ? "In trade" : "Available";
  const positionAccent =
    isInPosition == null
      ? null
      : isInPosition
        ? ("active" as const)
        : ("positive" as const);

  return (
    <div className="grid gap-0 rounded-[18px] border border-[rgba(18,18,18,0.08)] bg-[rgba(250,250,247,0.92)] shadow-[0_18px_40px_rgba(0,0,0,0.05)]">
      {/* Vault stats strip */}
      <div className="grid grid-cols-3 gap-3 p-[16px_18px]">
        <VaultStatCell
          label="Vault balance"
          value={formattedBalance}
          loading={isLoadingVault}
        />
        <VaultStatCell
          label="Allowance"
          value={formattedAllowance}
          loading={isLoadingVault}
        />
        <VaultStatCell
          label="Status"
          value={positionLabel}
          loading={isLoadingVault}
          accent={positionAccent}
        />
      </div>

      <Separator className="bg-[rgba(18,18,18,0.06)]" />

      {/* Max spend + Withdraw — side by side on sm+, stacked on mobile */}
      <div className="flex flex-col divide-y divide-[rgba(18,18,18,0.06)] sm:flex-row sm:divide-x sm:divide-y-0">
        {/* Max spend — expands to fill available width */}
        <div className="min-w-0 flex-1 p-[14px_18px]">
          <MaxSpendConfigurator
            marketSymbol={marketSymbol}
            spendAmount={spendAmount}
            onSpendAmountChange={onSpendAmountChange}
            onSubmit={onSubmitMaxSpend}
            isConfiguring={isConfiguringMaxSpend}
            isConnected={isConnected}
            error={maxSpendError}
            lastSignature={lastMaxSpendSignature}
            compact
          />
        </div>

        {/* Withdraw */}
        <form
          onSubmit={onSubmitWithdraw}
          className="flex flex-col justify-between gap-3 p-[14px_18px] sm:w-[220px] sm:shrink-0"
        >
          <span className="font-barlow text-[10px] font-semibold uppercase tracking-[0.14em] text-[rgba(18,18,18,0.42)]">
            Withdraw funds
          </span>
          <div className="flex flex-col gap-2">
            <Input
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={withdrawAmount}
              onChange={(e) => onWithdrawAmountChange(e.target.value)}
              disabled={isWithdrawing || !isConnected}
              className="h-9 w-full rounded-[10px] border-[rgba(18,18,18,0.12)] bg-white/60 font-barlow text-[13px] placeholder:text-[rgba(18,18,18,0.32)] focus-visible:ring-[rgba(18,18,18,0.24)]"
            />
            <button
              type="submit"
              disabled={isWithdrawing || !isConnected || !withdrawAmount.trim()}
              className="inline-flex h-9 w-full items-center justify-center rounded-[10px] border border-[rgba(18,18,18,0.14)] bg-[linear-gradient(180deg,rgba(20,18,16,0.96),rgba(8,8,8,0.98))] px-4 font-barlow text-[10px] font-semibold uppercase tracking-[0.14em] text-[#f7efe7] transition hover:bg-[linear-gradient(180deg,rgba(28,26,24,0.9),rgba(10,10,10,1))] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isWithdrawing ? "Sending…" : "Withdraw"}
            </button>
          </div>
          {withdrawError && (
            <p className="m-0 font-barlow text-[11px] font-semibold text-[#8a2d2d]">
              {withdrawError}
            </p>
          )}
          {lastWithdrawSignature && !withdrawError && (
            <p className="m-0 font-barlow text-[11px] font-semibold text-[#2e7d52]">
              Withdrawn · sig {lastWithdrawSignature.slice(0, 8)}…
            </p>
          )}
        </form>
      </div>

      <Separator className="bg-[rgba(18,18,18,0.06)]" />

      {/* Performance row + position action */}
      <div className="flex items-center justify-between gap-4 p-[14px_18px]">
        <div className="flex items-center gap-6">
          <div className="grid gap-1">
            <span className="font-barlow text-[10px] font-semibold uppercase tracking-[0.14em] text-[rgba(18,18,18,0.42)]">
              PnL
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1 font-instrument text-[22px] leading-none",
                pnlPercent >= 0 ? "text-[#2e7d52]" : "text-[#8a2d2d]",
              )}
            >
              {pnlPercent >= 0 ? (
                <TrendingUp size={14} aria-hidden="true" />
              ) : (
                <TrendingDown size={14} aria-hidden="true" />
              )}
              {pnlPercent >= 0 ? "+" : ""}
              {pnlPercent.toFixed(1)}%
            </span>
          </div>
          <div className="grid gap-1">
            <span className="font-barlow text-[10px] font-semibold uppercase tracking-[0.14em] text-[rgba(18,18,18,0.42)]">
              Win rate
            </span>
            <span className="font-instrument text-[22px] leading-none text-[#121212]">
              {winRate}%
            </span>
          </div>
          <div className="grid gap-1">
            <span className="font-barlow text-[10px] font-semibold uppercase tracking-[0.14em] text-[rgba(18,18,18,0.42)]">
              Open
            </span>
            <span className="inline-flex items-center gap-1 font-instrument text-[22px] leading-none text-[#121212]">
              <Minus size={12} aria-hidden="true" className="text-[rgba(18,18,18,0.38)]" />
              {openPositions}
            </span>
          </div>
        </div>

        {/* Close position — only shown when agent is in a trade */}
        {isInPosition && (
          <button
            type="button"
            onClick={onClosePosition}
            disabled={isClosingPosition || !isConnected}
            className="inline-flex h-9 shrink-0 items-center justify-center rounded-[10px] border border-[rgba(138,45,45,0.22)] bg-[rgba(251,238,236,0.96)] px-5 font-barlow text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8a2d2d] transition hover:bg-[rgba(251,238,236,1)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isClosingPosition ? "Closing…" : "Close Position"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function SelectedAgentPanel({
  className,
  agents,
  selectedAgent,
  selectedMarketSymbol,
  trackedMarkets,
  selectedTradeIdea,
  selectedPosition,
  selectedTrace,
  selectedWatchlist,
  selectedEvents,
  selectedNewsContexts,
  selectedNewsRationale,
  selectedBrowserSession,
  selectedVisionDecision,
  selectedActiveSetup,
  isWideWorkspace,
  conjureDitheringSize,
  isConjureRevealed,
  isConjureLoading,
  autoRestartedConjureSelectionKey,
  conjureSelectionKey,
  onSelectMarket,
  onOpenFundingModal,
  onOpenPrediction,
  spendAmount,
  onSpendAmountChange,
  onSubmitMaxSpend,
  isConfiguringMaxSpend,
  maxSpendError,
  lastMaxSpendSignature,
  isConnected,
  onRevealBrowserSession,
  onForceRestartBrowserSession,
  onResetBrowserSessionPanel,
  onMarkAutoRestarted,
  // vault
  vaultBalance,
  vaultAllowance,
  isInPosition,
  vaultDecimals,
  isLoadingVault,
  // withdraw
  withdrawAmount,
  onWithdrawAmountChange,
  onSubmitWithdraw,
  isWithdrawing,
  withdrawError,
  lastWithdrawSignature,
  // position
  onClosePosition,
  isClosingPosition,
}: {
  className?: string;
  agents: Array<{ id: string; score: number }>;
  selectedAgent: SelectedAgent;
  selectedMarketSymbol: string;
  trackedMarkets: TrackedMarket[];
  selectedTradeIdea?: TradeIdea;
  selectedPosition?: Position;
  selectedTrace?: VisualTrace;
  selectedWatchlist: WatchlistItem[];
  selectedEvents: TradeEvent[];
  selectedNewsContexts: SelectedNewsContext[];
  selectedNewsRationale: string;
  selectedBrowserSession: BrowserSession | null;
  selectedVisionDecision: SelectedVisionDecision | null;
  selectedActiveSetup: ActiveStrategySetup | null;
  isWideWorkspace: boolean;
  conjureDitheringSize: number;
  isConjureRevealed: boolean;
  isConjureLoading: boolean;
  autoRestartedConjureSelectionKey: string | null;
  conjureSelectionKey: string;
  onSelectMarket: (marketSymbol: string) => void;
  onOpenFundingModal: () => void;
  onOpenPrediction: () => void;
  spendAmount: string;
  onSpendAmountChange: (value: string) => void;
  onSubmitMaxSpend: React.FormEventHandler<HTMLFormElement>;
  isConfiguringMaxSpend: boolean;
  maxSpendError: string | null;
  lastMaxSpendSignature: string | null;
  isConnected: boolean;
  onRevealBrowserSession: () => Promise<void>;
  onForceRestartBrowserSession: () => Promise<void>;
  onResetBrowserSessionPanel: () => void;
  onMarkAutoRestarted: () => void;
  // vault
  vaultBalance: string | null;
  vaultAllowance: string | null;
  isInPosition: boolean | null;
  vaultDecimals: number;
  isLoadingVault: boolean;
  // withdraw
  withdrawAmount: string;
  onWithdrawAmountChange: (value: string) => void;
  onSubmitWithdraw: React.FormEventHandler<HTMLFormElement>;
  isWithdrawing: boolean;
  withdrawError: string | null;
  lastWithdrawSignature: string | null;
  // position
  onClosePosition: () => void;
  isClosingPosition: boolean;
}) {
  const isConjureActive = isConjureRevealed && !!selectedBrowserSession;
  const isConjureIdle = !isConjureRevealed;

  const selectedMarket = trackedMarkets.find(
    (m) => m.symbol === selectedMarketSymbol,
  );

  return (
    <section
      className={cn("grid grid-cols-1 gap-[18px]", className)}
      aria-label="Selected agent detail"
    >
      <article className={cn(surfaceCard, "grid gap-[18px] p-5")}>
        {/* Header */}
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="m-0 font-instrument text-[clamp(30px,4vw,48px)] font-normal leading-[0.96] tracking-[-0.5px]">
              {selectedAgent.name}
            </h2>
            <p className="mt-[14px] mb-0 max-w-[58ch] font-inter text-[14px] leading-[1.6] text-[rgba(18,18,18,0.62)]">
              {selectedAgent.lastAction}
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-3">
              <LiquidActionButton
                label="Fund this agent"
                colorBack="#9a6f26"
                colorTint="#ffe9a8"
                onClick={onOpenFundingModal}
              />
              <LiquidActionButton
                label="Enter Prediction"
                colorBack="#a9a9ab"
                colorTint="#ffffff"
                onClick={onOpenPrediction}
              />
          </div>
        </div>

        {/* Pair selector + vault control surface */}
        <div className="grid gap-3">
          {/* Pair dropdown */}
          <div className="flex items-center gap-3">
            <Select
              value={selectedMarketSymbol}
              onValueChange={(v) => {
                if (v) onSelectMarket(v);
              }}
            >
              <SelectTrigger className="h-[42px] w-[200px] rounded-[12px] border-[rgba(18,18,18,0.12)] bg-[rgba(255,255,255,0.72)] font-barlow text-[13px] font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.06)] backdrop-blur-sm focus:ring-[rgba(18,18,18,0.18)]">
                <SelectValue placeholder="Select pair" />
              </SelectTrigger>
              <SelectContent className="rounded-[14px] border-[rgba(18,18,18,0.1)] bg-white/96 shadow-[0_24px_60px_rgba(0,0,0,0.12)] backdrop-blur-sm">
                {trackedMarkets.map((market) => (
                  <SelectItem
                    key={market.symbol}
                    value={market.symbol}
                    className="cursor-pointer rounded-[10px] font-barlow text-[13px] font-semibold focus:bg-[rgba(18,18,18,0.05)]"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "size-[7px] shrink-0 rounded-full",
                          newsToneDot[market.newsState],
                        )}
                      />
                      {market.symbol}
                      {market.marketSyncStatus !== "no_data" && (
                        <span className="ml-1 font-barlow text-[10px] font-normal text-[rgba(18,18,18,0.42)]">
                          {formatSyncFreshness(market.newsUpdatedAt)}
                        </span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Active market news tone badge */}
            {selectedMarket &&
              selectedMarket.marketSyncStatus !== "no_data" && (
                <span
                  className={cn(
                    pillClass(selectedMarket.newsState as ConfluenceState),
                    "font-barlow",
                  )}
                >
                  {
                    confluenceToneMap[
                      selectedMarket.newsState as ConfluenceState
                    ]
                  }
                </span>
              )}
          </div>

          {/* Vault control surface */}
          <VaultControlSurface
            vaultBalance={vaultBalance}
            vaultAllowance={vaultAllowance}
            isInPosition={isInPosition}
            vaultDecimals={vaultDecimals}
            isLoadingVault={isLoadingVault}
            marketSymbol={selectedMarketSymbol}
            spendAmount={spendAmount}
            onSpendAmountChange={onSpendAmountChange}
            onSubmitMaxSpend={onSubmitMaxSpend}
            isConfiguringMaxSpend={isConfiguringMaxSpend}
            maxSpendError={maxSpendError}
            lastMaxSpendSignature={lastMaxSpendSignature}
            isConnected={isConnected}
            withdrawAmount={withdrawAmount}
            onWithdrawAmountChange={onWithdrawAmountChange}
            onSubmitWithdraw={onSubmitWithdraw}
            isWithdrawing={isWithdrawing}
            withdrawError={withdrawError}
            lastWithdrawSignature={lastWithdrawSignature}
            onClosePosition={onClosePosition}
            isClosingPosition={isClosingPosition}
            onOpenPrediction={onOpenPrediction}
            pnlPercent={selectedAgent.pnlPercent}
            winRate={selectedAgent.winRate}
            openPositions={selectedAgent.openPositions}
          />
        </div>

        {/* Trade idea card */}
        {selectedTradeIdea ? (
          <div className="grid gap-[18px] rounded-[18px] border border-[rgba(18,18,18,0.08)] bg-[rgba(255,255,255,0.78)] p-5 shadow-[0_18px_40px_rgba(0,0,0,0.05)] backdrop-blur-[16px]">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-[10px]">
                <Eye aria-hidden="true" size={18} />
                <h3 className="m-0 font-barlow text-[14px] font-semibold uppercase tracking-[0.06em]">
                  Current trade idea
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    pillClass(selectedTradeIdea.confluenceState),
                    "font-barlow",
                  )}
                >
                  {confluenceToneMap[selectedTradeIdea.confluenceState]}
                </span>
                <span className={cn(chipClass, "font-barlow")}>
                  {selectedTradeIdea.status}
                </span>
              </div>
            </div>
            <p className="font-inter">{selectedTradeIdea.thesis}</p>
            <div className="mt-[18px] grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <span className="font-barlow text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgba(18,18,18,0.48)]">
                  Entry
                </span>
                <strong className="font-instrument text-[clamp(24px,3vw,38px)] font-normal leading-[0.95]">
                  {selectedTradeIdea.entry}
                </strong>
              </div>
              <div>
                <span className="font-barlow text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgba(18,18,18,0.48)]">
                  Stop loss
                </span>
                <strong className="font-instrument text-[clamp(24px,3vw,38px)] font-normal leading-[0.95]">
                  {selectedTradeIdea.stopLoss}
                </strong>
              </div>
              <div>
                <span className="font-barlow text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgba(18,18,18,0.48)]">
                  Take profit
                </span>
                <strong className="font-instrument text-[clamp(24px,3vw,38px)] font-normal leading-[0.95]">
                  {selectedTradeIdea.takeProfit}
                </strong>
              </div>
              <div>
                <span className="font-barlow text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgba(18,18,18,0.48)]">
                  Confidence
                </span>
                <strong className="font-instrument text-[clamp(24px,3vw,38px)] font-normal leading-[0.95]">
                  {Math.round(selectedTradeIdea.confidence * 100)}%
                </strong>
              </div>
            </div>
          </div>
        ) : null}

        {/* Conjure viewport */}
        <div
          className={cn(
            "h-[80px] overflow-hidden rounded-[10px] transition-[height] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]",
            (isConjureActive || isConjureLoading) && "h-[600px]",
          )}
        >
          {isConjureIdle ? (
            <button
              type="button"
              className="relative block h-full w-full cursor-pointer overflow-hidden rounded-[10px] border-0 bg-[#f5f5f2] p-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.88),inset_0_-1px_0_rgba(0,0,0,0.08)] transition-transform duration-[120ms] hover:-translate-y-px active:scale-[0.985]"
              onClick={() => void onRevealBrowserSession()}
            >
              <LiquidMetal
                className="!absolute inset-0 !h-full !w-full pointer-events-none"
                colorBack="#a9a9ab"
                colorTint="#ffffff"
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
              <span className="pointer-events-none absolute inset-[8px] z-[2] inline-flex min-h-[44px] items-center justify-center rounded-md border border-[rgba(255,255,255,0.42)] bg-[rgba(255,255,255,0.16)] px-6 font-instrument text-[clamp(22px,2vw,30px)] font-medium tracking-[0.02em] !text-[#121212] [text-shadow:0_1px_0_rgba(255,255,255,0.34)] shadow-[inset_0_1px_0_rgba(255,255,255,0.34),inset_0_-1px_0_rgba(255,255,255,0.08),0_18px_40px_rgba(0,0,0,0.08)] backdrop-blur-[14px]">
                Conjure {selectedAgent.name}
              </span>
            </button>
          ) : isConjureLoading ? (
            <div className="relative block h-full w-full overflow-hidden rounded-[20px] border-0 p-0">
              <ImageDithering
                image="https://res.cloudinary.com/ddlz0zesx/image/upload/v1777216792/enter_the_arena_smth_qazlcz.png"
                colorBack="#000c38"
                colorFront="#94ffaf"
                colorHighlight="#eaff94"
                originalColors={false}
                inverted={false}
                type="8x8"
                size={conjureDitheringSize}
                colorSteps={2}
                fit="cover"
                width="100%"
                height="100%"
              />
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center font-instrument text-[clamp(18px,3vw,26px)] font-normal tracking-[-0.3px] text-[#94ffaf] [text-shadow:0_1px_12px_rgba(0,12,56,0.6)]">
                Conjuring {selectedAgent.name}...
              </span>
            </div>
          ) : selectedBrowserSession ? (
            <BrowserSessionViewport
              sessionId={selectedBrowserSession.id}
              sessionStatus={selectedBrowserSession.status}
              onRestart={onRevealBrowserSession}
              onStartupExhausted={() => {
                if (autoRestartedConjureSelectionKey !== conjureSelectionKey) {
                  onMarkAutoRestarted();
                  void onForceRestartBrowserSession();
                  return;
                }
                onResetBrowserSessionPanel();
              }}
            />
          ) : (
            <div className="relative block h-full w-full overflow-hidden rounded-[20px] border-0 p-0">
              <ImageDithering
                image="https://res.cloudinary.com/ddlz0zesx/image/upload/v1777216792/enter_the_arena_smth_qazlcz.png"
                colorBack="#000c38"
                colorFront="#94ffaf"
                colorHighlight="#eaff94"
                originalColors={false}
                inverted={false}
                type="8x8"
                size={conjureDitheringSize}
                colorSteps={2}
                fit="cover"
                width="100%"
                height="100%"
              />
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center font-instrument text-[clamp(18px,3vw,26px)] font-normal tracking-[-0.3px] text-[#94ffaf] [text-shadow:0_1px_12px_rgba(0,12,56,0.6)]">
                Reconnecting {selectedAgent.name}...
              </span>
            </div>
          )}
        </div>
      </article>

      {/* Aside — existing disclosure cards */}
      <aside
        className={cn(
          "grid gap-[18px]",
          isWideWorkspace && "md:grid-cols-[repeat(3,minmax(0,1fr))]",
        )}
      >
        {selectedActiveSetup ? (
          <article className={cn(surfaceCard, "p-5")}>
            <DisclosureSection
              title="Setup lifecycle"
              icon={<Activity aria-hidden="true" size={18} />}
              badge={
                <span className={cn(chipClass, "font-barlow")}>
                  {selectedActiveSetup.state.replaceAll("_", " ")}
                </span>
              }
            >
              <div
                className={cn("grid gap-[14px]", disclosureScrollViewportClass)}
              >
                <div className="flex flex-wrap gap-[6px]">
                  <span className={cn(chipClass, "font-barlow")}>
                    {selectedActiveSetup.setupType.replaceAll("_", " ")}
                  </span>
                  <span className={cn(chipClass, "font-barlow")}>
                    {selectedActiveSetup.direction !== "none"
                      ? selectedActiveSetup.direction
                      : "no direction"}
                  </span>
                  <span className={cn(chipClass, "font-barlow")}>
                    {selectedActiveSetup.regime}
                  </span>
                  <span className={cn(chipClass, "font-barlow")}>
                    {Math.round(selectedActiveSetup.confidence * 100)}%
                    confidence
                  </span>
                </div>
                {selectedActiveSetup.zoneLow != null &&
                selectedActiveSetup.zoneHigh != null ? (
                  <div className="grid gap-1 rounded-[12px] bg-[rgba(250,250,247,0.94)] p-3">
                    <span className="font-barlow text-[12px] font-semibold text-[rgba(18,18,18,0.7)]">
                      Active zone — {selectedActiveSetup.zoneLow} to{" "}
                      {selectedActiveSetup.zoneHigh}
                    </span>
                    <span className="font-inter text-[13px] leading-[1.5] text-[rgba(18,18,18,0.6)]">
                      Projected price{" "}
                      {selectedActiveSetup.projectedPrice ?? "—"}
                    </span>
                  </div>
                ) : null}
                {selectedActiveSetup.invalidationLow != null &&
                selectedActiveSetup.invalidationHigh != null ? (
                  <div className="grid gap-1 rounded-[12px] bg-[rgba(251,238,236,0.84)] p-3">
                    <span className="font-barlow text-[12px] font-semibold text-[#8a2d2d]">
                      Invalidation — {selectedActiveSetup.invalidationLow} to{" "}
                      {selectedActiveSetup.invalidationHigh}
                    </span>
                    <span className="font-inter text-[13px] leading-[1.5] text-[rgba(18,18,18,0.6)]">
                      {selectedActiveSetup.invalidationNote ??
                        "Awaiting explicit invalidation threshold."}
                    </span>
                  </div>
                ) : null}
                <div className="grid gap-[6px] rounded-[12px] bg-[rgba(246,244,239,0.96)] p-3">
                  <span className="font-barlow text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(18,18,18,0.45)]">
                    Stateful thesis
                  </span>
                  <p className="m-0 font-inter text-[13px] leading-[1.55] text-[rgba(18,18,18,0.68)]">
                    {selectedActiveSetup.rationaleSummary}
                  </p>
                  <span className="font-barlow text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(18,18,18,0.38)]">
                    Last reviewed{" "}
                    {formatReviewFreshness(selectedActiveSetup.lastReviewedAt)}
                  </span>
                </div>
              </div>
            </DisclosureSection>
          </article>
        ) : null}

        {selectedVisionDecision ? (
          <article className={cn(surfaceCard, "p-5")}>
            <DisclosureSection
              title="Vision analysis"
              icon={<Eye aria-hidden="true" size={18} />}
              badge={
                <span
                  className={cn(
                    pillClass(
                      selectedVisionDecision.verdict === "valid"
                        ? "supportive"
                        : selectedVisionDecision.verdict === "staged"
                          ? "neutral"
                          : "risk",
                    ),
                    "font-barlow",
                  )}
                >
                  {selectedVisionDecision.verdict}
                </span>
              }
            >
              <div
                className={cn("grid gap-[14px]", disclosureScrollViewportClass)}
              >
                <div className="flex flex-wrap gap-[6px]">
                  <span className={cn(chipClass, "font-barlow")}>
                    {selectedVisionDecision.regime}
                  </span>
                  <span className={cn(chipClass, "font-barlow")}>
                    structure {selectedVisionDecision.structureStatus}
                  </span>
                  <span className={cn(chipClass, "font-barlow")}>
                    {selectedVisionDecision.direction !== "none"
                      ? selectedVisionDecision.direction
                      : "no direction"}
                  </span>
                  <span className={cn(chipClass, "font-barlow")}>
                    {Math.round(selectedVisionDecision.confidence * 100)}%
                    confidence
                  </span>
                </div>
                <p className="m-0 font-inter text-[13.5px] leading-[1.65] text-[rgba(18,18,18,0.72)]">
                  {selectedVisionDecision.rationale}
                </p>
                {selectedVisionDecision.correctedT1 ? (
                  <div className="grid gap-1 rounded-[12px] bg-[rgba(250,250,247,0.94)] p-3">
                    <span className="font-barlow text-[12px] font-semibold text-[rgba(18,18,18,0.7)]">
                      T1 — {selectedVisionDecision.correctedT1.price}
                    </span>
                    <span className="font-inter text-[13px] leading-[1.5] text-[rgba(18,18,18,0.6)]">
                      {selectedVisionDecision.correctedT1.note}
                    </span>
                  </div>
                ) : null}
                {selectedVisionDecision.correctedT2 ? (
                  <div className="grid gap-1 rounded-[12px] bg-[rgba(250,250,247,0.94)] p-3">
                    <span className="font-barlow text-[12px] font-semibold text-[rgba(18,18,18,0.7)]">
                      T2 — {selectedVisionDecision.correctedT2.price}
                    </span>
                    <span className="font-inter text-[13px] leading-[1.5] text-[rgba(18,18,18,0.6)]">
                      {selectedVisionDecision.correctedT2.note}
                    </span>
                  </div>
                ) : null}
                {selectedVisionDecision.invalidationZone ? (
                  <div className="grid gap-1 rounded-[12px] bg-[rgba(251,238,236,0.84)] p-3">
                    <span className="font-barlow text-[12px] font-semibold text-[#8a2d2d]">
                      Invalidation zone —{" "}
                      {selectedVisionDecision.invalidationZone.low} to{" "}
                      {selectedVisionDecision.invalidationZone.high}
                    </span>
                    <span className="font-inter text-[13px] leading-[1.5] text-[rgba(18,18,18,0.6)]">
                      {selectedVisionDecision.invalidationZone.note}
                    </span>
                  </div>
                ) : null}
                {selectedVisionDecision.invalidationNote ? (
                  <div className="grid gap-1 rounded-[12px] bg-[rgba(247,240,231,0.96)] p-3">
                    <span className="font-barlow text-[12px] font-semibold text-[rgba(18,18,18,0.7)]">
                      Why it failed
                    </span>
                    <span className="font-inter text-[13px] leading-[1.5] text-[rgba(18,18,18,0.6)]">
                      {selectedVisionDecision.invalidationNote}
                    </span>
                  </div>
                ) : null}
                {selectedVisionDecision.issues.length > 0 ? (
                  <div className="grid gap-2">
                    <span className="font-barlow text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(18,18,18,0.45)]">
                      Open issues
                    </span>
                    <ul className="m-0 grid gap-[6px] pl-[18px]">
                      {selectedVisionDecision.issues.map((issue, index) => (
                        <li
                          key={index}
                          className="font-inter text-[13px] leading-[1.5] text-[rgba(18,18,18,0.62)]"
                        >
                          {issue}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </DisclosureSection>
          </article>
        ) : null}

        <article className={cn(surfaceCard, "p-5")}>
          <DisclosureSection
            title="News confluence"
            icon={<Newspaper aria-hidden="true" size={18} />}
            badge={
              selectedNewsContexts.length ? (
                <span className={cn(chipClass, "font-barlow")}>
                  {selectedNewsContexts.length} items
                </span>
              ) : undefined
            }
          >
            <div
              className={cn("grid gap-[10px]", disclosureScrollViewportClass)}
            >
              {selectedNewsRationale ? (
                <div className="mb-[4px] grid gap-2 rounded-[16px] bg-[rgba(250,250,247,0.96)] p-[16px_18px]">
                  <span className="font-barlow text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgba(18,18,18,0.48)]">
                    Why this confluence
                  </span>
                  <p className="m-0 font-inter text-[14px] leading-[1.6] text-[rgba(18,18,18,0.72)]">
                    {selectedNewsRationale}
                  </p>
                </div>
              ) : null}
              {selectedNewsContexts.length ? (
                selectedNewsContexts.map((item) => {
                  const isCalendarRow =
                    item.sourceLabel === "Economic Calendar";
                  return (
                    <div
                      key={item.id}
                      className={cn(
                        "grid gap-[6px] rounded-[16px] p-[14px] text-inherit no-underline",
                        isCalendarRow
                          ? "bg-[rgba(247,240,231,0.96)]"
                          : "bg-[rgba(250,250,247,0.92)]",
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="inline-flex flex-wrap items-center gap-2">
                          <span
                            className={cn(pillClass(item.state), "font-barlow")}
                          >
                            {confluenceToneMap[item.state]}
                          </span>
                          <span className={cn(chipClass, "font-barlow")}>
                            {isCalendarRow
                              ? "Scheduled event"
                              : "Headline flow"}
                          </span>
                        </div>
                        {item.url ? (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-[6px] font-barlow text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgba(18,18,18,0.58)] no-underline hover:text-[rgba(18,18,18,0.86)]"
                          >
                            Source
                            <ExternalLink aria-hidden="true" size={12} />
                          </a>
                        ) : null}
                      </div>
                      <strong className="font-barlow text-[15px] font-semibold">
                        {item.headline}
                      </strong>
                      <span className="font-inter text-[14px] leading-[1.6] text-[rgba(18,18,18,0.62)]">
                        {item.marketSymbol} · {item.sourceLabel} ·{" "}
                        {item.publishedAt}
                      </span>
                      <p className="mt-[2px] mb-0 font-inter text-[14px] leading-[1.6] text-[rgba(18,18,18,0.62)]">
                        {item.note}
                      </p>
                    </div>
                  );
                })
              ) : (
                <EmptyState
                  title="No current news confluence"
                  description="No mapped news context is attached to this market yet. The agent will rely on technical structure until a confluence signal is logged."
                />
              )}
            </div>
          </DisclosureSection>
        </article>

        <article className={cn(surfaceCard, "p-5")}>
          <DisclosureSection
            title="Watchlist state"
            icon={<Radar aria-hidden="true" size={18} />}
            badge={
              selectedWatchlist.length ? (
                <span className={cn(chipClass, "font-barlow")}>
                  {selectedWatchlist.length} active
                </span>
              ) : undefined
            }
          >
            <div
              className={cn("grid gap-[10px]", disclosureScrollViewportClass)}
            >
              {selectedWatchlist.length ? (
                selectedWatchlist.map((item) => (
                  <div
                    key={item.id}
                    className="grid gap-[6px] rounded-[16px] bg-[rgba(250,250,247,0.92)] p-[14px]"
                  >
                    <strong className="font-barlow text-[15px] font-semibold">
                      {item.setupLabel}
                    </strong>
                    <span className="font-inter text-[14px] leading-[1.6] text-[rgba(18,18,18,0.62)]">
                      {item.marketSymbol} · {item.timeframe} · {item.status}
                    </span>
                    <p className="mt-[2px] mb-0 font-inter text-[14px] leading-[1.6] text-[rgba(18,18,18,0.62)]">
                      {item.triggerNote}
                    </p>
                  </div>
                ))
              ) : (
                <EmptyState
                  title="Nothing on watch here yet"
                  description="This market is in the agent's orbit, but there is no active watchlist state recorded for the current timeframe."
                />
              )}
            </div>
          </DisclosureSection>
        </article>

        <article className={cn(surfaceCard, "p-5")}>
          <DisclosureSection
            title="Agent event log"
            icon={<Activity aria-hidden="true" size={18} />}
            badge={
              selectedEvents.length ? (
                <span className={cn(chipClass, "font-barlow")}>
                  {selectedEvents.length} steps
                </span>
              ) : undefined
            }
          >
            <div
              className={cn("grid gap-[10px]", disclosureScrollViewportClass)}
            >
              {selectedEvents.length ? (
                selectedEvents.map((event) => (
                  <div
                    key={event.id}
                    className="grid grid-cols-[auto_1fr] gap-3 rounded-[16px] bg-[rgba(250,250,247,0.92)] p-[14px]"
                  >
                    <span className="font-barlow text-[11px] font-bold uppercase tracking-[0.12em] text-[rgba(18,18,18,0.4)]">
                      {event.timestamp}
                    </span>
                    <div>
                      <strong className="font-barlow text-[15px] font-semibold">
                        {event.title}
                      </strong>
                      <span className="font-inter text-[14px] leading-[1.6] text-[rgba(18,18,18,0.62)]">
                        {event.detail}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState
                  title="No event history for this market"
                  description="The selected agent has not yet logged market-specific events for this symbol."
                />
              )}
            </div>
          </DisclosureSection>
        </article>
      </aside>
    </section>
  );
}
