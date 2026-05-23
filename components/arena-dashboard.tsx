"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { useSignTransaction } from "@privy-io/react-auth/solana";
import {
  Activity,
  ArrowLeft,
  Eye,
  ExternalLink,
  LineChart,
  LogOut,
  Newspaper,
  Radar,
  Trophy,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { ImageDithering, LiquidMetal } from "@paper-design/shaders-react";
import type {
  SwingPointsForBrowser,
  FibonacciLegForBrowser,
} from "@/lib/browser-session-runtime";
import { cn } from "@/lib/utils";
import { useSolanaWallet } from "@/components/convex-client-provider";
import { encodeBase64 } from "@/lib/base64";
import {
  chipClass,
  confluenceToneMap,
  DisclosureSection,
  EmptyState,
  formatEventTimeLabel,
  formatNewsFreshness,
  formatUnknownError,
  LiquidActionButton,
  pillClass,
  skelBase,
  statusLabelMap,
  surfaceCard,
} from "@/components/arena/arena-shared";
import { BrowserSessionViewport } from "@/components/arena/browser-session-viewport";
import { SignInCard } from "@/components/arena/sign-in-card";
import { AgentFundingModal } from "@/components/arena/agent-funding-modal";
import type {
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

type ArenaSnapshot = {
  agents: Array<{
    _id: string;
    slug: string;
    name: string;
    strategyLabel: string;
    status: keyof typeof statusLabelMap;
    primaryMarket: string;
    timeframe: TradeTimeframe;
    winRate: number;
    pnlPercent: number;
    openPositions: number;
    score: number;
    lastAction: string;
    trackedMarkets: string[];
  }>;
  markets: Array<{
    _id: string;
    symbol: string;
    displayName: string;
    assetClass: "commodity" | "forex" | "synthetic";
    price: number;
    changePercent: number;
    dailyRange: string;
    sessionBias: "bullish" | "bearish" | "mixed";
    newsState?: ConfluenceState;
    newsRationale?: string;
    newsUpdatedAt?: number | null;
  }>;
  watchlistItems: Array<{
    _id: string;
    agentSlug: string;
    marketSymbol: string;
    setupLabel: string;
    timeframe: TradeTimeframe;
    status: "watching" | "armed";
    triggerNote: string;
    confluenceState: ConfluenceState;
  }>;
  tradeIdeas: Array<{
    _id: string;
    agentSlug: string;
    marketSymbol: string;
    direction: "long" | "short";
    status: "watchlist" | "ready" | "entered" | "closed";
    entry: number;
    stopLoss: number;
    takeProfit: number;
    confidence: number;
    confluenceState: ConfluenceState;
    thesis: string;
  }>;
  positions: Array<{
    _id: string;
    agentSlug: string;
    marketSymbol: string;
    direction: "long" | "short";
    timeframe: TradeTimeframe;
    entry: number;
    markPrice: number;
    stopLoss: number;
    takeProfit: number;
    pnlPercent: number;
    progressLabel: string;
    nextCheckIn: string;
  }>;
  tradeEvents: Array<{
    _id: string;
    agentSlug: string;
    marketSymbol: string;
    timestampLabel: string;
    eventTimeSec?: number;
    title: string;
    detail: string;
    stage: TradeEvent["stage"];
    focusKind?: TradeEvent["focusKind"];
  }>;
  visualTraces: Array<{
    _id: string;
    agentSlug: string;
    marketSymbol: string;
    timeframe: TradeTimeframe;
    updatedAtLabel: string;
    annotations: Array<{
      annotationId: string;
      type: VisualTrace["annotations"][number]["type"];
      label: string;
      detail: string;
      revealStep?: number;
      geometry?: VisualTrace["annotations"][number]["geometry"];
    }>;
  }>;
  newsContexts: Array<{
    _id: string;
    marketSymbol: string;
    headline: string;
    state: ConfluenceState;
    sourceLabel: string;
    publishedAtLabel: string;
    note: string;
    rationale?: string;
    url?: string;
    agentSlug?: string | null;
  }>;
  browserSessions: Array<{
    _id: string;
    agentSlug: string;
    marketSymbol: string;
    timeframe: TradeTimeframe;
    browserTargetSymbol?: string;
    browserTargetTimeframe?: string;
    inspectedOn: "deriv";
    targetUrl: string;
    status: BrowserSession["status"];
    currentStepLabel: string;
    currentStepIndex: number;
    totalSteps: number;
    startedAt: number;
    updatedAt: number;
    completedAt?: number;
    error?: string;
  }>;
  browserSessionEvents: Array<{
    _id: string;
    sessionId: string;
    sequence: number;
    label: string;
    detail: string;
    status: BrowserSessionEvent["status"];
  }>;
  scanRuns: Array<{
    startedAt: number;
  }>;
  visionDecisions: Array<{
    agentSlug: string;
    marketSymbol: string;
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
    capturedAt: number;
  }>;
};

function getMarketRoles(args: {
  marketSymbol: string;
  primaryMarket: string;
  hasWatchlist: boolean;
  hasPosition: boolean;
}) {
  return [
    args.primaryMarket === args.marketSymbol ? "primary" : null,
    args.hasWatchlist ? "watchlist" : null,
    args.hasPosition ? "open" : null,
  ].filter(Boolean) as string[];
}

function formatRelativeMinutes(timestamp: number | null) {
  if (!timestamp) return "Not yet run";

  const deltaSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}m ago`;
  return `${Math.floor(deltaSeconds / 3600)}h ago`;
}

const CANDLE_SECONDS: Record<string, number> = {
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
};

function extractSwingPoints(
  trace: VisualTrace | undefined,
  timeframe: string,
): SwingPointsForBrowser | undefined {
  if (!trace) return undefined;

  let t1Price: number | undefined;
  let t1TimeSec: number | undefined;
  let t2Price: number | undefined;
  let t2TimeSec: number | undefined;
  let projectedPrice: number | undefined;
  let t3TimeSec: number | undefined;
  let zoneLow: number | undefined;
  let zoneHigh: number | undefined;

  for (const annotation of trace.annotations) {
    const g = annotation.geometry;
    if (!g) continue;
    if (g.kind === "marker" && g.text === "T1") {
      t1Price = g.position.price;
      t1TimeSec = g.position.timeSec;
    }
    if (g.kind === "marker" && g.text === "T2") {
      t2Price = g.position.price;
      t2TimeSec = g.position.timeSec;
    }
    if (g.kind === "line") {
      projectedPrice = g.end.price;
      t3TimeSec = g.end.timeSec;
    }
    if (g.kind === "zone") {
      zoneLow = g.lowPrice;
      zoneHigh = g.highPrice;
    }
  }

  if (
    t1Price === undefined ||
    t2Price === undefined ||
    projectedPrice === undefined ||
    zoneLow === undefined ||
    zoneHigh === undefined
  ) {
    return undefined;
  }

  const allPrices = [t1Price, t2Price, projectedPrice, zoneLow, zoneHigh];
  const rawLow = Math.min(...allPrices);
  const rawHigh = Math.max(...allPrices);
  const padding = (rawHigh - rawLow) * 0.2;

  return {
    t1Price,
    t1TimeSec,
    t2Price,
    t2TimeSec,
    projectedPrice,
    t3TimeSec,
    zoneLow,
    zoneHigh,
    direction: t2Price > t1Price ? "long" : "short",
    visiblePriceLow: rawLow - padding,
    visiblePriceHigh: rawHigh + padding,
    candleSeconds: CANDLE_SECONDS[timeframe] ?? 3600,
  };
}

function extractFibonacciLegs(trace: VisualTrace | undefined): {
  legs: FibonacciLegForBrowser[];
  preferredZone?: { low: number; high: number };
} {
  if (!trace) return { legs: [] };

  const legs: FibonacciLegForBrowser[] = [];
  let preferredZone: { low: number; high: number } | undefined;

  for (const annotation of trace.annotations) {
    const g = annotation.geometry;
    if (!g) continue;

    if (
      g.kind === "fibonacci" &&
      g.startTimeSec !== undefined &&
      g.endTimeSec !== undefined
    ) {
      legs.push({
        lowTimeSec: g.startTimeSec,
        lowPrice: g.lowPrice,
        highTimeSec: g.endTimeSec,
        highPrice: g.highPrice,
        isMuted: g.tone === "muted",
      });
    }

    // Preferred zone: tone === "zone" (the engine sets this only on the preferred band)
    if (g.kind === "zone" && g.tone === "zone") {
      preferredZone = { low: g.lowPrice, high: g.highPrice };
    }
  }

  return { legs, preferredZone };
}

export default function ArenaDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { rpc, chain, selectedWallet, selectedAccount, isConnected } =
    useSolanaWallet();
  const { signTransaction } = useSignTransaction();
  const snapshot = useQuery(api.arena.getArenaSnapshot, {}) as
    | ArenaSnapshot
    | undefined;
  const updateAgentDisplayNames = useMutation(
    api.arena.updateAgentDisplayNames,
  );
  const startBrowserReviewSession = useAction(
    api.arena.startBrowserReviewSession,
  );
  const prepareFundAgentVault = useAction(
    api.agentVault.prepareFundAgentVault,
  );
  const submitFundAgentVault = useAction(api.agentVault.submitFundAgentVault);
  const [isStartingBrowserSession, setIsStartingBrowserSession] =
    useState(false);
  const [revealedConjureSelectionKey, setRevealedConjureSelectionKey] =
    useState<string | null>(null);
  const [
    autoRestartedConjureSelectionKey,
    setAutoRestartedConjureSelectionKey,
  ] = useState<string | null>(null);
  const isWideWorkspace = true;
  const conjureDitheringSize = 2;
  const didRenameRef = useRef(false);
  const [isSubscribeModalOpen, setIsSubscribeModalOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [isFundingAgent, setIsFundingAgent] = useState(false);
  const [fundingError, setFundingError] = useState<string | null>(null);
  const [lastFundingSignature, setLastFundingSignature] = useState<
    string | null
  >(null);

  // One-time migration: rename agents to mythical names if they still have old names
  useEffect(() => {
    if (didRenameRef.current || !snapshot) return;
    const needsRename = snapshot.agents.some(
      (a) => a.name === "Fibonacci Trend" || a.name === "Third Touch",
    );
    if (!needsRename) {
      didRenameRef.current = true;
      return;
    }
    didRenameRef.current = true;
    void updateAgentDisplayNames({});
  }, [snapshot, updateAgentDisplayNames]);

  const selectedAgentSlug = searchParams.get("agent");
  const selectedMarketParam = searchParams.get("market");

  const handleSubscribeSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedAgent || !depositAmount.trim()) {
      return;
    }
    if (!selectedWallet || !selectedAccount || !isConnected) {
      setFundingError("Connect a Solana wallet before funding this agent.");
      return;
    }

    setIsFundingAgent(true);
    setFundingError(null);

    try {
      const preparedFunding = await prepareFundAgentVault({
        walletAddress: selectedAccount.address,
        agentName: selectedAgent.name,
        amountUi: depositAmount.trim(),
      });
      const signedFunding = await signTransaction({
        chain,
        wallet: selectedWallet,
        transaction: Uint8Array.from(
          atob(preparedFunding.transactionBase64),
          (character) => character.charCodeAt(0),
        ),
      });
      const result = await submitFundAgentVault({
        walletAddress: selectedAccount.address,
        signedTransactionBase64: encodeBase64(
          signedFunding.signedTransaction,
        ),
      });

      setLastFundingSignature(result.signature);
      setDepositAmount("");
      setIsSubscribeModalOpen(false);
      console.log("[subscription] Funded agent vault:", {
        agentId: selectedAgent.id,
        mint: preparedFunding.mint,
        amountBaseUnits: preparedFunding.amountBaseUnits,
        signature: result.signature,
      });
    } catch (error) {
      console.error("[fund-agent-vault] failed", {
        agentId: selectedAgent.id,
        agentName: selectedAgent.name,
        amountUi: depositAmount.trim(),
        chain,
        walletName: selectedWallet.standardWallet.name,
        accountAddress: selectedAccount.address,
        error,
      });
      const nextMessage = formatUnknownError(error) || "Failed to fund agent vault.";
      setFundingError(
        nextMessage.includes("Configured fee destination")
          ? `${nextMessage} Reinitialize the vault global state on this cluster with a valid fee token account.`
          : nextMessage,
      );
    } finally {
      setIsFundingAgent(false);
    }
  };

  const derived = useMemo(() => {
    if (!snapshot) return null;

    const agents = snapshot.agents.map((agent) => ({
      id: agent.slug,
      name: agent.name,
      strategyLabel: agent.strategyLabel,
      status: agent.status,
      primaryMarket: agent.primaryMarket,
      timeframe: agent.timeframe,
      winRate: agent.winRate,
      pnlPercent: agent.pnlPercent,
      openPositions: agent.openPositions,
      score: agent.score,
      lastAction: agent.lastAction,
      trackedMarkets: agent.trackedMarkets,
    }));

    const markets = snapshot.markets.map((market) => ({
      symbol: market.symbol,
      displayName: market.displayName,
      assetClass: market.assetClass,
      price: market.price,
      changePercent: market.changePercent,
      dailyRange: market.dailyRange,
      sessionBias: market.sessionBias,
      newsState: market.newsState ?? "neutral",
      newsRationale: market.newsRationale ?? "",
      newsUpdatedAt: market.newsUpdatedAt ?? null,
    }));

    const watchlistItems: WatchlistItem[] = snapshot.watchlistItems.map(
      (item) => ({
        id: String(item._id),
        agentId: item.agentSlug,
        marketSymbol: item.marketSymbol,
        setupLabel: item.setupLabel,
        timeframe: item.timeframe,
        status: item.status,
        triggerNote: item.triggerNote,
        confluenceState: item.confluenceState,
      }),
    );

    const tradeIdeas: TradeIdea[] = snapshot.tradeIdeas.map((idea) => ({
      id: String(idea._id),
      agentId: idea.agentSlug,
      marketSymbol: idea.marketSymbol,
      direction: idea.direction,
      status: idea.status,
      entry: idea.entry,
      stopLoss: idea.stopLoss,
      takeProfit: idea.takeProfit,
      confidence: idea.confidence,
      confluenceState: idea.confluenceState,
      thesis: idea.thesis,
    }));

    const positions: Position[] = snapshot.positions.map((position) => ({
      id: String(position._id),
      agentId: position.agentSlug,
      marketSymbol: position.marketSymbol,
      direction: position.direction,
      timeframe: position.timeframe,
      entry: position.entry,
      markPrice: position.markPrice,
      stopLoss: position.stopLoss,
      takeProfit: position.takeProfit,
      pnlPercent: position.pnlPercent,
      progressLabel: position.progressLabel,
      nextCheckIn: position.nextCheckIn,
    }));

    const tradeEvents: TradeEvent[] = snapshot.tradeEvents.map((event) => ({
      id: String(event._id),
      agentId: event.agentSlug,
      marketSymbol: event.marketSymbol,
      timestamp:
        formatEventTimeLabel(event.eventTimeSec) || event.timestampLabel,
      eventTimeSec: event.eventTimeSec ?? undefined,
      title: event.title,
      detail: event.detail,
      stage: event.stage,
      focusKind: event.focusKind ?? undefined,
    }));

    const visualTraces: VisualTrace[] = snapshot.visualTraces.map((trace) => ({
      id: String(trace._id),
      agentId: trace.agentSlug,
      marketSymbol: trace.marketSymbol,
      timeframe: trace.timeframe,
      updatedAt: trace.updatedAtLabel,
      annotations: trace.annotations.map((annotation) => ({
        id: annotation.annotationId,
        type: annotation.type,
        label: annotation.label,
        detail: annotation.detail,
        revealStep: annotation.revealStep,
        geometry: annotation.geometry,
      })),
    }));

    const newsContexts = snapshot.newsContexts.map((item) => ({
      id: String(item._id),
      marketSymbol: item.marketSymbol,
      headline: item.headline,
      state: item.state,
      sourceLabel: item.sourceLabel,
      publishedAt: item.publishedAtLabel,
      note: item.note,
      rationale: item.rationale ?? "",
      url: item.url ?? "",
      agentSlug: item.agentSlug ?? null,
    }));
    const browserSessions: BrowserSession[] = snapshot.browserSessions.map(
      (session) => ({
        id: String(session._id),
        agentId: session.agentSlug,
        marketSymbol: session.marketSymbol,
        timeframe: session.timeframe,
        browserTargetSymbol: session.browserTargetSymbol,
        browserTargetTimeframe: session.browserTargetTimeframe,
        inspectedOn: session.inspectedOn,
        targetUrl: session.targetUrl,
        status: session.status,
        currentStepLabel: session.currentStepLabel,
        currentStepIndex: session.currentStepIndex,
        totalSteps: session.totalSteps,
        startedAt: session.startedAt,
        updatedAt: session.updatedAt,
        completedAt: session.completedAt ?? undefined,
        error: session.error ?? undefined,
      }),
    );
    const browserSessionEvents: BrowserSessionEvent[] =
      snapshot.browserSessionEvents.map((event) => ({
        id: String(event._id),
        sessionId: String(event.sessionId),
        sequence: event.sequence,
        label: event.label,
        detail: event.detail,
        status: event.status,
      }));

    const selectedAgent = selectedAgentSlug
      ? (agents.find((agent) => agent.id === selectedAgentSlug) ?? null)
      : null;
    if (!selectedAgent) {
      return {
        agents,
        markets,
        positions,
        tradeEvents,
        lastScanAt: snapshot.scanRuns[0]?.startedAt ?? null,
        selectedAgent: null,
      };
    }

    const trackedMarketSymbols = Array.from(
      new Set([
        ...selectedAgent.trackedMarkets,
        selectedAgent.primaryMarket,
        ...watchlistItems
          .filter((item) => item.agentId === selectedAgent.id)
          .map((item) => item.marketSymbol),
        ...positions
          .filter((item) => item.agentId === selectedAgent.id)
          .map((item) => item.marketSymbol),
        ...tradeIdeas
          .filter((item) => item.agentId === selectedAgent.id)
          .map((item) => item.marketSymbol),
        ...visualTraces
          .filter((item) => item.agentId === selectedAgent.id)
          .map((item) => item.marketSymbol),
        ...tradeEvents
          .filter((item) => item.agentId === selectedAgent.id)
          .map((item) => item.marketSymbol),
      ]),
    );

    const selectedMarketSymbol =
      trackedMarketSymbols.find((symbol) => symbol === selectedMarketParam) ??
      selectedAgent.primaryMarket;

    const trackedMarkets = trackedMarketSymbols
      .map((symbol) => markets.find((market) => market.symbol === symbol))
      .filter((market): market is (typeof markets)[number] => Boolean(market));

    const selectedTradeIdea = tradeIdeas.find(
      (idea) =>
        idea.agentId === selectedAgent.id &&
        idea.marketSymbol === selectedMarketSymbol,
    );
    const selectedTrace = visualTraces.find(
      (trace) =>
        trace.agentId === selectedAgent.id &&
        trace.marketSymbol === selectedMarketSymbol,
    );
    const selectedEvents = tradeEvents.filter(
      (event) =>
        event.agentId === selectedAgent.id &&
        event.marketSymbol === selectedMarketSymbol,
    );
    const selectedWatchlist = watchlistItems.filter(
      (item) =>
        item.agentId === selectedAgent.id &&
        item.marketSymbol === selectedMarketSymbol,
    );
    const selectedPosition = positions.find(
      (position) =>
        position.agentId === selectedAgent.id &&
        position.marketSymbol === selectedMarketSymbol,
    );
    const selectedNewsContexts = newsContexts
      .filter(
        (item) =>
          item.marketSymbol === selectedMarketSymbol &&
          (item.agentSlug === null || item.agentSlug === selectedAgent.id),
      )
      .slice(0, 4);
    const selectedNewsRationale = selectedNewsContexts[0]?.rationale ?? "";
    const selectedAgentOpenPositions = positions.filter(
      (position) => position.agentId === selectedAgent.id,
    ).length;
    const selectedBrowserSession =
      browserSessions
        .filter(
          (session) =>
            session.agentId === selectedAgent.id &&
            session.marketSymbol === selectedMarketSymbol &&
            session.status !== "failed" &&
            session.status !== "completed",
        )
        .sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;
    const selectedBrowserSessionEvents = selectedBrowserSession
      ? browserSessionEvents.filter(
          (event) => event.sessionId === selectedBrowserSession.id,
        )
      : [];
    const selectedVisionDecision =
      snapshot.visionDecisions?.find(
        (d) =>
          d.agentSlug === selectedAgent.id &&
          d.marketSymbol === selectedMarketSymbol,
      ) ?? null;

    return {
      agents,
      markets,
      positions,
      tradeEvents,
      trackedMarkets,
      selectedAgent: {
        ...selectedAgent,
        openPositions: selectedAgentOpenPositions,
      },
      selectedMarketSymbol,
      selectedTradeIdea,
      selectedTrace,
      selectedEvents,
      selectedWatchlist,
      selectedPosition,
      selectedNewsContexts,
      selectedNewsRationale,
      selectedBrowserSession,
      selectedBrowserSessionEvents,
      selectedVisionDecision,
      lastScanAt: snapshot.scanRuns[0]?.startedAt ?? null,
    };
  }, [selectedAgentSlug, selectedMarketParam, snapshot]);

  // Auto-reset "starting" flag once Convex delivers the real session
  const selectedBrowserSessionId = derived?.selectedBrowserSession?.id ?? null;
  useEffect(() => {
    if (selectedBrowserSessionId) {
      setIsStartingBrowserSession(false);
    }
  }, [selectedBrowserSessionId]);

  const selectedConjureKey = derived?.selectedAgent
    ? `${derived.selectedAgent.id}::${derived.selectedMarketSymbol}`
    : null;

  useEffect(() => {
    setRevealedConjureSelectionKey(null);
    setAutoRestartedConjureSelectionKey(null);
    setIsStartingBrowserSession(false);
  }, [selectedConjureKey]);

  if (!snapshot || !derived) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(0,0,0,0.05),transparent_28%),linear-gradient(180deg,#f4f4f1_0%,#ecece8_100%)] text-[#121212]">
        <section className="w-full max-w-[1280px] mx-auto px-6 pt-8 pb-16">
          {/* ── Header skeleton ── */}
          <header className="grid grid-cols-[minmax(0,1.8fr)_minmax(280px,0.9fr)] gap-6 items-start">
            <div
              className={cn(
                skelBase,
                "w-[220px] h-[32px] rounded-[8px] mb-[10px]",
              )}
            />
            <div
              className={cn(skelBase, "w-[340px] h-[14px] rounded-[4px] mb-5")}
            />
            <div className="flex flex-wrap gap-[10px]">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className={cn(
                    skelBase,
                    "inline-block w-[72px] h-[24px] rounded-[20px]",
                  )}
                />
              ))}
            </div>
          </header>

          {/* ── Leaderboard table skeleton ── */}
          <section className="mt-6">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-[rgba(18,18,18,0.1)]">
                  {[
                    "#",
                    "Agent",
                    "Strategy",
                    "Status",
                    "Win rate",
                    "PnL",
                    "Positions",
                    "Markets",
                    "Score",
                  ].map((h) => (
                    <th
                      key={h}
                      className="font-barlow px-[14px] py-2 text-left text-[11px] font-semibold tracking-[0.12em] uppercase text-[rgba(18,18,18,0.42)] whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3].map((row) => (
                  <tr
                    key={row}
                    className="border-b border-[rgba(18,18,18,0.055)] cursor-pointer transition-colors hover:bg-[rgba(18,18,18,0.03)]"
                  >
                    <td className="px-[14px] py-[13px] align-middle">
                      <div className={cn(skelBase, "w-[24px] h-[14px]")} />
                    </td>
                    <td className="px-[14px] py-[13px] align-middle">
                      <div className={cn(skelBase, "w-[90px] h-[15px]")} />
                    </td>
                    <td className="px-[14px] py-[13px] align-middle">
                      <div className={cn(skelBase, "w-[160px] h-[14px]")} />
                    </td>
                    <td className="px-[14px] py-[13px] align-middle">
                      <div
                        className={cn(
                          skelBase,
                          "inline-block w-[72px] h-[24px] rounded-[20px]",
                        )}
                      />
                    </td>
                    <td className="px-[14px] py-[13px] align-middle">
                      <div className={cn(skelBase, "w-[44px] h-[14px]")} />
                    </td>
                    <td className="px-[14px] py-[13px] align-middle">
                      <div className={cn(skelBase, "w-[44px] h-[14px]")} />
                    </td>
                    <td className="px-[14px] py-[13px] align-middle">
                      <div className={cn(skelBase, "w-[44px] h-[14px]")} />
                    </td>
                    <td className="px-[14px] py-[13px] align-middle">
                      <div className={cn(skelBase, "w-[44px] h-[14px]")} />
                    </td>
                    <td className="px-[14px] py-[13px] align-middle">
                      <div
                        className={cn(
                          skelBase,
                          "w-[48px] h-[20px] rounded-[4px]",
                        )}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </section>
      </main>
    );
  }

  if (!derived.selectedAgent && !derived.agents?.length) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(0,0,0,0.05),transparent_28%),linear-gradient(180deg,#f4f4f1_0%,#ecece8_100%)] text-[#121212]">
        <section className="w-full max-w-[1280px] mx-auto px-6 pt-8 pb-16">
          <div className={cn(surfaceCard, "p-5")}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-[10px]">
                <Radar aria-hidden="true" size={18} />
                <h2 className="font-barlow m-0 text-[14px] font-semibold tracking-[0.06em] uppercase">
                  Arena state
                </h2>
              </div>
            </div>
            <EmptyState
              title="No agents available yet"
              description="The arena does not have a seeded state yet, so there is nothing to render on this surface."
            />
          </div>
        </section>
      </main>
    );
  }

  const {
    agents,
    positions,
    tradeEvents,
    trackedMarkets = [],
    selectedAgent,
    selectedMarketSymbol,
    selectedTradeIdea,
    selectedTrace,
    selectedEvents = [],
    selectedWatchlist = [],
    selectedPosition,
    selectedNewsContexts = [],
    selectedNewsRationale,
    selectedBrowserSession,
    selectedBrowserSessionEvents = [],
    selectedVisionDecision,
    lastScanAt,
  } = derived;
  const selectedMarket = trackedMarkets.find(
    (market) => market.symbol === selectedMarketSymbol,
  );

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(0,0,0,0.05),transparent_28%),linear-gradient(180deg,#f4f4f1_0%,#ecece8_100%)] text-[#121212]">
      <section className="w-full max-w-[1280px] mx-auto px-6 pt-8 pb-16">
        <header className="grid grid-cols-[minmax(0,1.8fr)_minmax(280px,0.9fr)] gap-6 items-start">
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-2 min-h-[40px] mb-[18px] text-[rgba(18,18,18,0.72)] text-[12px] font-semibold tracking-[0.14em] uppercase no-underline font-barlow"
            >
              <ArrowLeft aria-hidden="true" size={16} />
              Back to landing
            </Link>
            <p className="m-0 mb-[10px] text-[rgba(18,18,18,0.42)] text-[12px] font-semibold tracking-[0.18em] uppercase font-barlow">
              Arena season zero
            </p>
            <h1 className="max-w-[12ch] m-0 text-[clamp(42px,7vw,92px)] font-normal leading-[0.94] tracking-[-0.8px] font-instrument">
              Strategy agents tracking structure, confluence, and execution
              state.
            </h1>
            <p className="max-w-[60ch] mt-5 mb-0 text-[rgba(18,18,18,0.64)] text-[16px] leading-[1.7] font-inter">
              Monitor active agents, watched markets, chart annotations, and
              staged trade logic as the arena evolves across each symbol.
            </p>
          </div>

          <div className="flex flex-wrap gap-[10px]">
            {/* Season */}
            <div className={cn(surfaceCard, "grid gap-2 p-[18px]")}>
              <span className="font-barlow text-[rgba(18,18,18,0.48)] text-[11px] font-semibold tracking-[0.14em] uppercase">
                Season
              </span>
              <strong className="font-instrument text-[32px] font-normal leading-[0.95]">
                Season Zer0
              </strong>
            </div>
            {/* Agents live */}
            <div className={cn(surfaceCard, "grid gap-2 p-[18px]")}>
              <span className="font-barlow text-[rgba(18,18,18,0.48)] text-[11px] font-semibold tracking-[0.14em] uppercase">
                Agents live
              </span>
              <strong className="font-instrument text-[32px] font-normal leading-[0.95]">
                {agents.length}
              </strong>
            </div>
            {/* Last scan */}
            {/* <div className={cn(surfaceCard, "grid gap-2 p-[18px]")}>
              <span className="font-barlow text-[rgba(18,18,18,0.48)] text-[11px] font-semibold tracking-[0.14em] uppercase">
                Last scan
              </span>
              <strong className="font-instrument text-[32px] font-normal leading-[0.95]">
                {formatRelativeMinutes(lastScanAt)}
              </strong>
            </div> */}
            <SignInCard />
          </div>
        </header>

        <section className="mt-6" aria-label="Arena leaderboard">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-[rgba(18,18,18,0.1)]">
                <th className="font-barlow px-[14px] py-2 text-left text-[11px] font-semibold tracking-[0.12em] uppercase text-[rgba(18,18,18,0.42)] whitespace-nowrap">
                  #
                </th>
                <th className="font-barlow px-[14px] py-2 text-left text-[11px] font-semibold tracking-[0.12em] uppercase text-[rgba(18,18,18,0.42)] whitespace-nowrap">
                  Agent
                </th>
                <th className="font-barlow px-[14px] py-2 text-left text-[11px] font-semibold tracking-[0.12em] uppercase text-[rgba(18,18,18,0.42)] whitespace-nowrap">
                  Strategy
                </th>
                <th className="font-barlow px-[14px] py-2 text-left text-[11px] font-semibold tracking-[0.12em] uppercase text-[rgba(18,18,18,0.42)] whitespace-nowrap">
                  Status
                </th>
                <th className="font-barlow px-[14px] py-2 text-left text-[11px] font-semibold tracking-[0.12em] uppercase text-[rgba(18,18,18,0.42)] whitespace-nowrap">
                  Win rate
                </th>
                <th className="font-barlow px-[14px] py-2 text-left text-[11px] font-semibold tracking-[0.12em] uppercase text-[rgba(18,18,18,0.42)] whitespace-nowrap">
                  PnL
                </th>
                <th className="font-barlow px-[14px] py-2 text-left text-[11px] font-semibold tracking-[0.12em] uppercase text-[rgba(18,18,18,0.42)] whitespace-nowrap">
                  Positions
                </th>
                <th className="font-barlow px-[14px] py-2 text-left text-[11px] font-semibold tracking-[0.12em] uppercase text-[rgba(18,18,18,0.42)] whitespace-nowrap">
                  Markets
                </th>
                <th className="font-barlow px-[14px] py-2 text-left text-[11px] font-semibold tracking-[0.12em] uppercase text-[rgba(18,18,18,0.42)] whitespace-nowrap">
                  Score
                </th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent, index) => {
                const isSelected = agent.id === selectedAgent?.id;
                const agentPositions = positions.filter(
                  (p) => p.agentId === agent.id,
                );
                return (
                  <tr
                    key={agent.id}
                    className={cn(
                      "border-b border-[rgba(18,18,18,0.055)] cursor-pointer transition-colors hover:bg-[rgba(18,18,18,0.03)]",
                      isSelected && "bg-[rgba(18,18,18,0.055)]",
                    )}
                    onClick={() => {
                      router.replace(`/arena?agent=${agent.id}`, {
                        scroll: false,
                      });
                    }}
                  >
                    <td className="px-[14px] py-[13px] align-middle text-[rgba(18,18,18,0.35)] text-[12px] w-9 font-barlow">
                      {String(index + 1).padStart(2, "0")}
                    </td>
                    <td className="px-[14px] py-[13px] align-middle">
                      <strong className="font-barlow text-[14px] font-semibold">
                        {agent.name}
                      </strong>
                    </td>
                    <td className="px-[14px] py-[13px] align-middle text-[rgba(18,18,18,0.55)] text-[13px] font-inter">
                      {agent.strategyLabel}
                    </td>
                    <td className="px-[14px] py-[13px] align-middle">
                      <span className={cn(chipClass, "font-barlow")}>
                        {statusLabelMap[agent.status]}
                      </span>
                    </td>
                    <td className="px-[14px] py-[13px] align-middle font-barlow">
                      {agent.winRate}%
                    </td>
                    <td
                      className={cn(
                        "px-[14px] py-[13px] align-middle font-barlow",
                        agent.pnlPercent >= 0
                          ? "text-[#1a7f46]"
                          : "text-[#a33030]",
                      )}
                    >
                      {agent.pnlPercent >= 0 ? "+" : ""}
                      {agent.pnlPercent.toFixed(1)}%
                    </td>
                    <td className="px-[14px] py-[13px] align-middle font-barlow">
                      {agentPositions.length}
                    </td>
                    <td className="px-[14px] py-[13px] align-middle font-barlow">
                      {agent.trackedMarkets.length}
                    </td>
                    <td className="px-[14px] py-[13px] align-middle text-[18px] font-normal text-right font-instrument">
                      {agent.score}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {selectedAgent ? (
          <section
            className={cn(
              "grid gap-[18px] mt-7",
              isWideWorkspace
                ? "grid-cols-1"
                : "grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)]",
            )}
            aria-label="Selected agent detail"
          >
            <article className={cn(surfaceCard, "p-5 grid gap-[18px]")}>
              {/* ── Agent header ─────────────────────────────────────────── */}
              <div className="flex items-start justify-between gap-5">
                <div>
                  <p className="m-0 mb-[10px] text-[rgba(18,18,18,0.42)] text-[12px] font-semibold tracking-[0.18em] uppercase font-barlow">
                    Selected agent
                  </p>
                  <h2 className="m-0 text-[clamp(30px,4vw,48px)] font-normal leading-[0.96] tracking-[-0.5px] font-instrument">
                    {selectedAgent.name}
                  </h2>
                  <p className="max-w-[58ch] mt-[14px] mb-0 text-[rgba(18,18,18,0.62)] text-[14px] leading-[1.6] font-inter">
                    {selectedAgent.lastAction}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-[10px]">
                  <div className="flex flex-wrap gap-[10px] justify-end">
                    <span className={cn(chipClass, "font-barlow")}>
                      {selectedAgent.timeframe}
                    </span>
                  </div>
                  <div className="flex flex-wrap justify-end gap-3">
                    <LiquidActionButton
                      label="Fund this agent"
                      colorBack="#9a6f26"
                      colorTint="#ffe9a8"
                      onClick={() => setIsSubscribeModalOpen(true)}
                    />
                    <LiquidActionButton
                      label="Enter Prediction"
                      colorBack="#a9a9ab"
                      colorTint="#ffffff"
                      onClick={() => {
                        console.log(
                          "[prediction] Enter Prediction clicked for agent:",
                          selectedAgent.id,
                        );
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* ── Compact stats row ─────────────────────────────────────── */}
              <div className="flex flex-wrap border border-[rgba(18,18,18,0.08)] rounded-[16px] overflow-hidden bg-[rgba(250,250,247,0.92)]">
                <div className="grid gap-[3px] px-[18px] py-3 border-r border-[rgba(18,18,18,0.08)] flex-1 min-w-[90px]">
                  <span className="font-barlow text-[11px] font-semibold tracking-[0.1em] uppercase text-[rgba(18,18,18,0.42)]">
                    Win rate
                  </span>
                  <strong className="font-instrument text-[18px] font-normal leading-[1.1]">
                    {selectedAgent.winRate}%
                  </strong>
                </div>
                <div className="grid gap-[3px] px-[18px] py-3 border-r border-[rgba(18,18,18,0.08)] flex-1 min-w-[90px]">
                  <span className="font-barlow text-[11px] font-semibold tracking-[0.1em] uppercase text-[rgba(18,18,18,0.42)]">
                    PnL
                  </span>
                  <strong
                    className={cn(
                      "font-instrument text-[18px] font-normal leading-[1.1]",
                      selectedAgent.pnlPercent >= 0
                        ? "text-[#1a7f46]"
                        : "text-[#a33030]",
                    )}
                  >
                    {selectedAgent.pnlPercent >= 0 ? "+" : ""}
                    {selectedAgent.pnlPercent.toFixed(1)}%
                  </strong>
                </div>
                <div className="grid gap-[3px] px-[18px] py-3 border-r border-[rgba(18,18,18,0.08)] flex-1 min-w-[90px]">
                  <span className="font-barlow text-[11px] font-semibold tracking-[0.1em] uppercase text-[rgba(18,18,18,0.42)]">
                    Positions
                  </span>
                  <strong className="font-instrument text-[18px] font-normal leading-[1.1]">
                    {selectedAgent.openPositions}
                  </strong>
                </div>
                <div className="grid gap-[3px] px-[18px] py-3 border-r border-[rgba(18,18,18,0.08)] flex-1 min-w-[90px]">
                  <span className="font-barlow text-[11px] font-semibold tracking-[0.1em] uppercase text-[rgba(18,18,18,0.42)]">
                    Score
                  </span>
                  <strong className="font-instrument text-[18px] font-normal leading-[1.1]">
                    {agents.find((a) => a.id === selectedAgent.id)?.score ??
                      "—"}
                  </strong>
                </div>
                <div className="grid gap-[3px] px-[18px] py-3 flex-1 min-w-[90px] last:border-r-0">
                  <span className="font-barlow text-[11px] font-semibold tracking-[0.1em] uppercase text-[rgba(18,18,18,0.42)]">
                    Next check
                  </span>
                  <strong className="font-instrument text-[18px] font-normal leading-[1.1]">
                    {selectedPosition?.nextCheckIn ?? "Waiting"}
                  </strong>
                </div>
              </div>

              {/* ── Market switcher ───────────────────────────────────────── */}
              <div
                className="flex flex-wrap gap-3"
                aria-label="Tracked markets"
              >
                {trackedMarkets.map((market) => {
                  const isActive = market.symbol === selectedMarketSymbol;
                  return (
                    <Link
                      key={market.symbol}
                      href={`/arena?agent=${selectedAgent.id}&market=${encodeURIComponent(market.symbol)}`}
                      className={cn(
                        "grid gap-1 min-w-[180px] p-[14px] border border-[rgba(18,18,18,0.08)] rounded-[16px] text-inherit no-underline",
                        market.newsState === "supportive" &&
                          "bg-[rgba(231,248,237,0.84)]",
                        market.newsState === "neutral" &&
                          "bg-[rgba(250,250,247,0.92)]",
                        market.newsState === "risk" &&
                          "bg-[rgba(251,238,236,0.84)]",
                        isActive &&
                          "border-[rgba(18,18,18,0.14)] bg-[rgba(18,18,18,0.06)]",
                      )}
                    >
                      <strong className="font-barlow text-[14px] font-semibold">
                        {market.symbol}
                      </strong>
                      <div className="inline-flex items-center gap-2">
                        <span
                          className={cn(
                            pillClass(market.newsState as ConfluenceState),
                            "font-barlow",
                          )}
                        >
                          {
                            confluenceToneMap[
                              market.newsState as ConfluenceState
                            ]
                          }
                        </span>
                        <span className="font-barlow text-[rgba(18,18,18,0.42)] text-[10px] font-semibold tracking-[0.12em] uppercase">
                          {formatNewsFreshness(market.newsUpdatedAt)}
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>

              {/* ── Trade idea (compact) ──────────────────────────────────── */}
              {selectedTradeIdea ? (
                <div className="border border-[rgba(18,18,18,0.08)] rounded-[18px] bg-[rgba(255,255,255,0.78)] shadow-[0_18px_40px_rgba(0,0,0,0.05)] backdrop-blur-[16px] p-5 grid gap-[18px]">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-[10px]">
                      <Eye aria-hidden="true" size={18} />
                      <h3 className="font-barlow m-0 text-[14px] font-semibold tracking-[0.06em] uppercase">
                        Current trade idea
                      </h3>
                    </div>
                    <div className="flex gap-2 items-center">
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
                  <div className="grid grid-cols-4 gap-3 mt-[18px]">
                    <div>
                      <span className="font-barlow text-[rgba(18,18,18,0.48)] text-[11px] font-semibold tracking-[0.14em] uppercase">
                        Entry
                      </span>
                      <strong className="font-instrument text-[clamp(24px,3vw,38px)] font-normal leading-[0.95]">
                        {selectedTradeIdea.entry}
                      </strong>
                    </div>
                    <div>
                      <span className="font-barlow text-[rgba(18,18,18,0.48)] text-[11px] font-semibold tracking-[0.14em] uppercase">
                        Stop loss
                      </span>
                      <strong className="font-instrument text-[clamp(24px,3vw,38px)] font-normal leading-[0.95]">
                        {selectedTradeIdea.stopLoss}
                      </strong>
                    </div>
                    <div>
                      <span className="font-barlow text-[rgba(18,18,18,0.48)] text-[11px] font-semibold tracking-[0.14em] uppercase">
                        Take profit
                      </span>
                      <strong className="font-instrument text-[clamp(24px,3vw,38px)] font-normal leading-[0.95]">
                        {selectedTradeIdea.takeProfit}
                      </strong>
                    </div>
                    <div>
                      <span className="font-barlow text-[rgba(18,18,18,0.48)] text-[11px] font-semibold tracking-[0.14em] uppercase">
                        Confidence
                      </span>
                      <strong className="font-instrument text-[clamp(24px,3vw,38px)] font-normal leading-[0.95]">
                        {Math.round(selectedTradeIdea.confidence * 100)}%
                      </strong>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* ── Conjure button / viewport ─────────────────────────────── */}
              {(() => {
                // selectedAgent and selectedMarketSymbol are always defined here
                // (we are inside the `selectedAgent ?` guard), but TypeScript cannot
                // narrow through the IIFE function boundary — hence the assertions.
                const agentId = selectedAgent!.id;
                const agentName = selectedAgent!.name;
                const agentTimeframe = selectedAgent!.timeframe;
                const marketSym = selectedMarketSymbol!;
                const conjureSelectionKey = `${agentId}::${marketSym}`;
                const isConjureRevealed =
                  revealedConjureSelectionKey === conjureSelectionKey;
                const isConjureActive =
                  isConjureRevealed && !!selectedBrowserSession;
                const isConjureLoading =
                  isConjureRevealed &&
                  !selectedBrowserSession &&
                  isStartingBrowserSession;
                const isConjureIdle = !isConjureRevealed;

                async function launchBrowserSession(options?: {
                  forceNew?: boolean;
                }) {
                  setRevealedConjureSelectionKey(conjureSelectionKey);
                  if (!options?.forceNew) {
                    setAutoRestartedConjureSelectionKey(null);
                  }
                  if (selectedBrowserSession && !options?.forceNew) return;

                  setIsStartingBrowserSession(true);
                  try {
                    const result = await startBrowserReviewSession({
                      agentSlug: agentId,
                      marketSymbol: marketSym,
                      timeframe: agentTimeframe,
                    });

                    const isFibAgent = agentId === "fibonacci-trend";
                    let response: Response;

                    if (isFibAgent) {
                      const { legs, preferredZone } =
                        extractFibonacciLegs(selectedTrace);
                      response = await fetch(
                        "/api/browser-session/fibonacci/start",
                        {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            sessionId: result.sessionId,
                            agentSlug: agentId,
                            agentMarketSymbol: marketSym,
                            marketSymbol: result.browserTargetSymbol,
                            timeframe: result.browserTargetTimeframe,
                            targetUrl: "https://charts.deriv.com/deriv",
                            legs,
                            preferredZone,
                            direction: selectedTradeIdea?.direction ?? "long",
                          }),
                        },
                      );
                    } else {
                      response = await fetch("/api/browser-session/start", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          sessionId: result.sessionId,
                          marketSymbol: result.browserTargetSymbol,
                          timeframe: result.browserTargetTimeframe,
                          agentSlug: agentId,
                          agentMarketSymbol: marketSym,
                          targetUrl: "https://charts.deriv.com/deriv",
                          swingPoints:
                            result.browserTargetSymbol === marketSym
                              ? extractSwingPoints(
                                  selectedTrace,
                                  agentTimeframe,
                                )
                              : undefined,
                        }),
                      });
                    }

                    if (!response.ok) {
                      throw new Error("browser_startup_request_failed");
                    }
                  } catch {
                    setIsStartingBrowserSession(false);
                    setRevealedConjureSelectionKey(null);
                  }
                }

                return (
                  <div
                    className={cn(
                      "h-[80px] rounded-[10px] overflow-hidden transition-[height] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]",
                      (isConjureActive || isConjureLoading) && "h-[600px]",
                    )}
                  >
                    {isConjureIdle ? (
                      <button
                        type="button"
                        className="relative block w-full h-full p-0 border-0 rounded-[10px] overflow-hidden cursor-pointer bg-[#f5f5f2] shadow-[inset_0_1px_0_rgba(255,255,255,0.88),inset_0_-1px_0_rgba(0,0,0,0.08)] transition-transform duration-[120ms] hover:-translate-y-px active:scale-[0.985]"
                        onClick={() => void launchBrowserSession()}
                      >
                        <LiquidMetal
                          className="!absolute inset-0 !w-full !h-full pointer-events-none"
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
                        <span className="absolute inset-[8px] z-[2] inline-flex min-h-[44px] items-center justify-center rounded-md border border-[rgba(255,255,255,0.42)] bg-[rgba(255,255,255,0.16)] px-6 text-[clamp(22px,2vw,30px)] font-medium tracking-[0.02em] !text-[#121212] [text-shadow:0_1px_0_rgba(255,255,255,0.34)] shadow-[inset_0_1px_0_rgba(255,255,255,0.34),inset_0_-1px_0_rgba(255,255,255,0.08),0_18px_40px_rgba(0,0,0,0.08)] backdrop-blur-[14px] pointer-events-none font-instrument">
                          Conjure {agentName}
                        </span>
                      </button>
                    ) : isConjureLoading ? (
                      <div className="relative block w-full h-full p-0 border-0 rounded-[20px] overflow-hidden">
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
                        <span className="absolute inset-0 flex items-center justify-center text-[clamp(18px,3vw,26px)] font-normal text-[#94ffaf] tracking-[-0.3px] pointer-events-none [text-shadow:0_1px_12px_rgba(0,12,56,0.6)] font-instrument">
                          Conjuring {agentName}...
                        </span>
                      </div>
                    ) : selectedBrowserSession ? (
                      <BrowserSessionViewport
                        sessionId={selectedBrowserSession.id}
                        sessionStatus={selectedBrowserSession.status}
                        onRestart={() => launchBrowserSession()}
                        onStartupExhausted={() => {
                          if (
                            autoRestartedConjureSelectionKey !==
                            conjureSelectionKey
                          ) {
                            setAutoRestartedConjureSelectionKey(
                              conjureSelectionKey,
                            );
                            void launchBrowserSession({ forceNew: true });
                            return;
                          }

                          setRevealedConjureSelectionKey(null);
                          setAutoRestartedConjureSelectionKey(null);
                          setIsStartingBrowserSession(false);
                        }}
                      />
                    ) : (
                      <div className="relative block w-full h-full p-0 border-0 rounded-[20px] overflow-hidden">
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
                        <span className="absolute inset-0 flex items-center justify-center text-[clamp(18px,3vw,26px)] font-normal text-[#94ffaf] tracking-[-0.3px] pointer-events-none [text-shadow:0_1px_12px_rgba(0,12,56,0.6)] font-instrument">
                          Reconnecting {agentName}...
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()}
            </article>

            <aside
              className={cn(
                "grid gap-[18px]",
                isWideWorkspace && "grid-cols-[repeat(3,minmax(0,1fr))]",
              )}
            >
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
                    <div className="grid gap-[14px]">
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
                      <p className="m-0 text-[rgba(18,18,18,0.72)] text-[13.5px] leading-[1.65] font-inter">
                        {selectedVisionDecision.rationale}
                      </p>
                      {selectedVisionDecision.correctedT1 ? (
                        <div className="grid gap-1 p-3 rounded-[12px] bg-[rgba(250,250,247,0.94)]">
                          <span className="font-barlow text-[12px] font-semibold text-[rgba(18,18,18,0.7)]">
                            T1 — {selectedVisionDecision.correctedT1.price}
                          </span>
                          <span className="font-inter text-[13px] text-[rgba(18,18,18,0.6)] leading-[1.5]">
                            {selectedVisionDecision.correctedT1.note}
                          </span>
                        </div>
                      ) : null}
                      {selectedVisionDecision.correctedT2 ? (
                        <div className="grid gap-1 p-3 rounded-[12px] bg-[rgba(250,250,247,0.94)]">
                          <span className="font-barlow text-[12px] font-semibold text-[rgba(18,18,18,0.7)]">
                            T2 — {selectedVisionDecision.correctedT2.price}
                          </span>
                          <span className="font-inter text-[13px] text-[rgba(18,18,18,0.6)] leading-[1.5]">
                            {selectedVisionDecision.correctedT2.note}
                          </span>
                        </div>
                      ) : null}
                      {selectedVisionDecision.invalidationZone ? (
                        <div className="grid gap-1 p-3 rounded-[12px] bg-[rgba(251,238,236,0.84)]">
                          <span className="font-barlow text-[12px] font-semibold text-[#8a2d2d]">
                            Invalidation zone —{" "}
                            {selectedVisionDecision.invalidationZone.low} to{" "}
                            {selectedVisionDecision.invalidationZone.high}
                          </span>
                          <span className="font-inter text-[13px] text-[rgba(18,18,18,0.6)] leading-[1.5]">
                            {selectedVisionDecision.invalidationZone.note}
                          </span>
                        </div>
                      ) : null}
                      {selectedVisionDecision.invalidationNote ? (
                        <div className="grid gap-1 p-3 rounded-[12px] bg-[rgba(247,240,231,0.96)]">
                          <span className="font-barlow text-[12px] font-semibold text-[rgba(18,18,18,0.7)]">
                            Why it failed
                          </span>
                          <span className="font-inter text-[13px] text-[rgba(18,18,18,0.6)] leading-[1.5]">
                            {selectedVisionDecision.invalidationNote}
                          </span>
                        </div>
                      ) : null}
                      {selectedVisionDecision.issues.length > 0 ? (
                        <div className="grid gap-2">
                          <span className="font-barlow text-[rgba(18,18,18,0.45)] text-[11px] font-semibold tracking-[0.12em] uppercase">
                            Open issues
                          </span>
                          <ul className="m-0 pl-[18px] grid gap-[6px]">
                            {selectedVisionDecision.issues.map((issue, i) => (
                              <li
                                key={i}
                                className="font-inter text-[rgba(18,18,18,0.62)] text-[13px] leading-[1.5]"
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
                  {selectedNewsRationale ? (
                    <div className="grid gap-2 mb-[14px] p-[16px_18px] rounded-[16px] bg-[rgba(250,250,247,0.96)]">
                      <span className="font-barlow text-[rgba(18,18,18,0.48)] text-[11px] font-semibold tracking-[0.14em] uppercase">
                        Why this confluence
                      </span>
                      <p className="font-inter m-0 text-[rgba(18,18,18,0.72)] text-[14px] leading-[1.6]">
                        {selectedNewsRationale}
                      </p>
                    </div>
                  ) : null}
                  <div className="grid gap-[10px] mt-[18px]">
                    {selectedNewsContexts.length ? (
                      selectedNewsContexts.map((item) => {
                        const isCalendarRow =
                          item.sourceLabel === "Economic Calendar";

                        return (
                          <div
                            key={item.id}
                            className={cn(
                              "grid gap-[6px] p-[14px] rounded-[16px] no-underline text-inherit",
                              isCalendarRow
                                ? "bg-[rgba(247,240,231,0.96)]"
                                : "bg-[rgba(250,250,247,0.92)]",
                            )}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="inline-flex flex-wrap items-center gap-2">
                                <span
                                  className={cn(
                                    pillClass(item.state),
                                    "font-barlow",
                                  )}
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
                                  className="inline-flex items-center gap-[6px] text-[rgba(18,18,18,0.58)] text-[11px] font-semibold tracking-[0.14em] uppercase no-underline hover:text-[rgba(18,18,18,0.86)] font-barlow"
                                >
                                  Source
                                  <ExternalLink aria-hidden="true" size={12} />
                                </a>
                              ) : null}
                            </div>
                            <strong className="font-barlow text-[15px] font-semibold">
                              {item.headline}
                            </strong>
                            <span className="font-inter text-[rgba(18,18,18,0.62)] text-[14px] leading-[1.6]">
                              {item.marketSymbol} · {item.sourceLabel} ·{" "}
                              {item.publishedAt}
                            </span>
                            <p className="font-inter mt-[2px] mb-0 text-[rgba(18,18,18,0.62)] text-[14px] leading-[1.6]">
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
                  <div className="grid gap-[10px] mt-[18px]">
                    {selectedWatchlist.length ? (
                      selectedWatchlist.map((item) => (
                        <div
                          key={item.id}
                          className="grid gap-[6px] p-[14px] rounded-[16px] bg-[rgba(250,250,247,0.92)]"
                        >
                          <strong className="font-barlow text-[15px] font-semibold">
                            {item.setupLabel}
                          </strong>
                          <span className="font-inter text-[rgba(18,18,18,0.62)] text-[14px] leading-[1.6]">
                            {item.marketSymbol} · {item.timeframe} ·{" "}
                            {item.status}
                          </span>
                          <p className="font-inter mt-[2px] mb-0 text-[rgba(18,18,18,0.62)] text-[14px] leading-[1.6]">
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
                  <div className="grid gap-[10px] mt-[18px]">
                    {selectedEvents.length ? (
                      selectedEvents.map((event) => (
                        <div
                          key={event.id}
                          className="grid grid-cols-[auto_1fr] gap-3 p-[14px] rounded-[16px] bg-[rgba(250,250,247,0.92)]"
                        >
                          <span className="font-barlow text-[rgba(18,18,18,0.4)] text-[11px] font-bold tracking-[0.12em] uppercase">
                            {event.timestamp}
                          </span>
                          <div>
                            <strong className="font-barlow text-[15px] font-semibold">
                              {event.title}
                            </strong>
                            <span className="font-inter text-[rgba(18,18,18,0.62)] text-[14px] leading-[1.6]">
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
        ) : null}
      </section>
      {selectedAgent ? (
        <AgentFundingModal
          agentName={selectedAgent.name}
          agentStatus={selectedAgent.status}
          isOpen={isSubscribeModalOpen}
          isConnected={isConnected}
          depositAmount={depositAmount}
          fundingError={fundingError}
          lastFundingSignature={lastFundingSignature}
          isFundingAgent={isFundingAgent}
          onClose={() => setIsSubscribeModalOpen(false)}
          onDepositAmountChange={setDepositAmount}
          onSubmit={handleSubscribeSubmit}
        />
      ) : null}
    </main>
  );
}
