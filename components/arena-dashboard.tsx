"use client";

import Link from "next/link";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { useQuery as useTanstackQuery } from "@tanstack/react-query";
import { useSignTransaction } from "@privy-io/react-auth/solana";
import { ArrowLeft, ChevronDown, Radar } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type {
  SwingPointsForBrowser,
  FibonacciLegForBrowser,
} from "@/lib/browser-session-runtime";
import { cn } from "@/lib/utils";
import {
  useEcosystemWallet,
  useSolanaWallet,
} from "@/components/convex-client-provider";
import { encodeBase64 } from "@/lib/base64";
import { vaultSnapshotKeys } from "@/lib/queries/solana-vault";
import { celoVaultSnapshotKeys, celoUsdcBalanceKeys } from "@/lib/queries/celo-vault";
import {
  CELO_DEPOSIT_TOKEN_ADDRESS,
  CELO_DEPOSIT_TOKEN_DECIMALS,
  CELO_USDC_FEE_CURRENCY_ADDRESS,
  GILDORE_VAULT_CELO_ABI,
  GILDORE_VAULT_CELO_ADDRESS,
  MINIMAL_ERC20_ABI,
  fetchCeloVaultSnapshot,
  parseCeloDepositAmount,
} from "@/lib/celo/gildore-vault-celo";
import { formatUnits } from "viem";
import { getCeloChain } from "@/lib/ecosystem";
import { useIsMobile } from "@/hooks/use-media-query";
const celoChain = getCeloChain();
import {
  chipClass,
  confluenceToneMap,
  DisclosureSection,
  EmptyState,
  formatEventTimeLabel,
  formatUnknownError,
  LiquidActionButton,
  pillClass,
  skelBase,
  statusLabelMap,
  surfaceCard,
} from "@/components/arena/arena-shared";
import { SignInCard } from "@/components/arena/sign-in-card";
import { AgentFundingModal } from "@/components/arena/agent-funding-modal";
import { SelectedAgentPanel } from "@/components/arena/selected-agent-panel";
import type {
  ActiveStrategySetup,
  AnalysisRenderCache,
  AnalysisSchedule,
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
    marketSyncStatus?: "seeded" | "live" | "failed" | "no_data" | null;
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
    publishedAtMs?: number | null;
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
  strategySetups: Array<{
    _id: string;
    agentSlug: string;
    marketSymbol: string;
    state: ActiveStrategySetup["state"];
    setupType: ActiveStrategySetup["setupType"];
    direction: ActiveStrategySetup["direction"];
    regime: ActiveStrategySetup["regime"];
    confidence: number;
    zoneLow?: number;
    zoneHigh?: number;
    projectedPrice?: number;
    invalidationLow?: number;
    invalidationHigh?: number;
    invalidationNote?: string;
    t1Price?: number;
    t1Date?: string;
    t2Price?: number;
    t2Date?: string;
    rationaleSummary: string;
    createdAt: number;
    lastReviewedAt: number;
    entryPrice?: number;
    stopPrice?: number;
    targetPrice?: number;
    entryTriggeredAt?: number;
    completedAt?: number;
    parentSetupId?: string;
    isActive: boolean;
  }>;
  analysisSchedules: Array<{
    _id: string;
    agentSlug: string;
    marketSymbol: string;
    timeframe: TradeTimeframe;
    interestTier: AnalysisSchedule["interestTier"];
    lastReviewedAt?: number;
    nextReviewAt: number;
    lastReviewOutcome?: AnalysisSchedule["lastReviewOutcome"];
    lastError?: string;
    isNightWindow: boolean;
    productiveCount: number;
    staleCount: number;
    lastJobId?: string;
  }>;
  analysisRenderCaches: Array<{
    _id: string;
    agentSlug: string;
    marketSymbol: string;
    timeframe: TradeTimeframe;
    strategy: "third-touch";
    drawMode: "zone-only";
    direction: AnalysisRenderCache["direction"];
    verdict: AnalysisRenderCache["verdict"];
    structureVerdict: AnalysisRenderCache["structureVerdict"];
    structureStatus: AnalysisRenderCache["structureStatus"];
    confidence: number;
    t1Price?: number;
    t1Date?: string;
    t2Price?: number;
    t2Date?: string;
    zoneLow?: number;
    zoneHigh?: number;
    projectedPrice?: number;
    invalidationLow?: number;
    invalidationHigh?: number;
    invalidationNote?: string;
    reviewedAt: number;
  }>;
};

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
  const eco = useEcosystemWallet();
  const isCelo = eco.ecosystem === "celo";
  const snapshot = useQuery(api.arena.getArenaSnapshot, {}) as
    | ArenaSnapshot
    | undefined;
  const updateAgentDisplayNames = useMutation(
    api.arena.updateAgentDisplayNames,
  );
  const startBrowserReviewSession = useAction(
    api.arena.startBrowserReviewSession,
  );
  const requestAnalysisRefresh = useMutation(api.arena.requestAnalysisRefresh);
  const prepareFundAgentVault = useAction(api.agentVault.prepareFundAgentVault);
  const submitFundAgentVault = useAction(api.agentVault.submitFundAgentVault);
  const prepareRegisterTicker = useAction(api.agentVault.prepareRegisterTicker);
  const submitRegisterTicker = useAction(api.agentVault.submitRegisterTicker);
  const prepareWithdraw = useAction(api.agentVault.prepareWithdraw);
  const submitWithdraw = useAction(api.agentVault.submitWithdraw);
  const closePositionAction = useAction(api.agentVault.updateTickerCloseTrade);
  const getVaultSnapshot = useAction(api.agentVault.getVaultSnapshot);
  const ensureExecutionWallet = useAction(
    api.flashtrade.ensureExecutionWallet,
  );
  const closePositionActionCelo = useAction(api.agentVaultCelo.updateTickerCloseTradeCelo);
  const getVaultSnapshotCelo = useAction(api.agentVaultCelo.getVaultSnapshotCelo);
  const [isStartingBrowserSession, setIsStartingBrowserSession] =
    useState(false);
  const [revealedConjureSelectionKey, setRevealedConjureSelectionKey] =
    useState<string | null>(null);
  const [
    autoRestartedConjureSelectionKey,
    setAutoRestartedConjureSelectionKey,
  ] = useState<string | null>(null);
  const isMobile = useIsMobile();
  const isWideWorkspace = !isMobile;
  const conjureDitheringSize = 2;

  const miniPayReceiptUrl = (txHash: string) =>
    `https://link.minipay.xyz/receipt?tx=${txHash}&celebrate`;
  const MINIPAY_ADD_FUNDS_URL = "https://link.minipay.xyz/add_cash?tokens=USDC";
  const didRenameRef = useRef(false);
  const ensuredExecutionWalletAddressRef = useRef<string | null>(null);
  const [isSubscribeModalOpen, setIsSubscribeModalOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [isFundingAgent, setIsFundingAgent] = useState(false);
  const [fundingError, setFundingError] = useState<string | null>(null);
  const [lastFundingSignature, setLastFundingSignature] = useState<
    string | null
  >(null);
  const [maxSpendAmount, setMaxSpendAmount] = useState("");
  const [isConfiguringMaxSpend, setIsConfiguringMaxSpend] = useState(false);
  const [maxSpendError, setMaxSpendError] = useState<string | null>(null);
  const [lastMaxSpendSignature, setLastMaxSpendSignature] = useState<
    string | null
  >(null);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [lastWithdrawSignature, setLastWithdrawSignature] = useState<
    string | null
  >(null);
  const [isClosingPosition, setIsClosingPosition] = useState(false);

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

  useEffect(() => {
    if (isCelo || !isConnected || !selectedAccount?.address) {
      return;
    }

    if (ensuredExecutionWalletAddressRef.current === selectedAccount.address) {
      return;
    }

    ensuredExecutionWalletAddressRef.current = selectedAccount.address;
    void ensureExecutionWallet({
      walletAddress: selectedAccount.address,
    }).catch((error) => {
      ensuredExecutionWalletAddressRef.current = null;
      console.error("[execution-wallet] failed to ensure wallet on auth", {
        walletAddress: selectedAccount.address,
        error,
      });
    });
  }, [
    ensureExecutionWallet,
    isCelo,
    isConnected,
    selectedAccount?.address,
  ]);

  const selectedAgentSlug = searchParams.get("agent");
  const selectedMarketParam = searchParams.get("market");

  const handleSubscribeSubmitCelo = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    if (!selectedAgent || !depositAmount.trim()) {
      return;
    }
    const celoAddress = eco.address;
    if (!eco.isConnected || !celoAddress) {
      setFundingError("Connect a Celo wallet before funding this agent.");
      return;
    }
    if (!GILDORE_VAULT_CELO_ADDRESS) {
      setFundingError("Celo vault is not configured for this environment.");
      return;
    }

    setIsFundingAgent(true);
    setFundingError(null);

    try {
      const walletClient = await eco.getCeloWalletClient();
      if (!walletClient) {
        throw new Error("No Celo wallet available.");
      }
      if (!CELO_DEPOSIT_TOKEN_ADDRESS) {
        throw new Error("CELO_DEPOSIT_TOKEN_ADDRESS is not configured.");
      }
      const agentId = await eco.celoPublicClient.readContract({
        address: GILDORE_VAULT_CELO_ADDRESS,
        abi: GILDORE_VAULT_CELO_ABI,
        functionName: "deriveAgentId",
        args: [selectedAgent.name.toLowerCase()],
      });
      const amountBaseUnits = parseCeloDepositAmount(depositAmount.trim());
      const feeCurrencyArgs = eco.isMiniPay
        ? { feeCurrency: CELO_USDC_FEE_CURRENCY_ADDRESS }
        : {};

      // Check ERC-20 allowance and approve if needed before deposit.
      const allowance = await eco.celoPublicClient.readContract({
        address: CELO_DEPOSIT_TOKEN_ADDRESS,
        abi: MINIMAL_ERC20_ABI,
        functionName: "allowance",
        args: [celoAddress as `0x${string}`, GILDORE_VAULT_CELO_ADDRESS],
      });
      if ((allowance as bigint) < amountBaseUnits) {
        const { request: approveRequest } = await eco.celoPublicClient.simulateContract({
          address: CELO_DEPOSIT_TOKEN_ADDRESS,
          abi: MINIMAL_ERC20_ABI,
          functionName: "approve",
          args: [GILDORE_VAULT_CELO_ADDRESS, amountBaseUnits],
          account: celoAddress as `0x${string}`,
        });
        const approveHash = await walletClient.writeContract({
          ...approveRequest,
          ...feeCurrencyArgs,
        } as Parameters<typeof walletClient.writeContract>[0]);
        // Wait for approval to land before depositing.
        await eco.celoPublicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      const { request: depositRequest } = await eco.celoPublicClient.simulateContract({
        address: GILDORE_VAULT_CELO_ADDRESS,
        abi: GILDORE_VAULT_CELO_ABI,
        functionName: "depositForAgentUse",
        args: [agentId, amountBaseUnits],
        account: celoAddress as `0x${string}`,
      });
      const txHash = await walletClient.writeContract({
        ...depositRequest,
        ...feeCurrencyArgs,
      } as Parameters<typeof walletClient.writeContract>[0]);

      setLastFundingSignature(txHash);
      setDepositAmount("");
      setIsSubscribeModalOpen(false);
      if (eco.isMiniPay) {
        window.open(miniPayReceiptUrl(txHash), "_top");
      }
      console.log("[subscription] Funded Celo agent vault:", {
        agentId: selectedAgent.id,
        amountBaseUnits: amountBaseUnits.toString(),
        txHash,
      });
    } catch (error) {
      console.error("[fund-agent-vault-celo] failed", {
        agentId: selectedAgent.id,
        agentName: selectedAgent.name,
        amountUi: depositAmount.trim(),
        address: celoAddress,
        error,
      });
      const errMsg = formatUnknownError(error) || "Failed to fund agent vault.";
      const isLowBalance =
        typeof errMsg === "string" &&
        (errMsg.toLowerCase().includes("insufficient") ||
          errMsg.toLowerCase().includes("exceeds balance") ||
          errMsg.toLowerCase().includes("transfer amount"));
      setFundingError(
        isLowBalance && eco.isMiniPay
          ? `__low_balance__${MINIPAY_ADD_FUNDS_URL}`
          : errMsg,
      );
    } finally {
      setIsFundingAgent(false);
    }
  };

  const handleSubscribeSubmit = async (event: FormEvent<HTMLFormElement>) => {
    if (isCelo) {
      return handleSubscribeSubmitCelo(event);
    }

    event.preventDefault();
    if (!selectedAgent || !depositAmount.trim()) {
      return;
    }
    if (!selectedWallet || !selectedAccount || !isConnected) {
      setFundingError("Connect your wallet before funding this agent.");
      return;
    }

    setIsFundingAgent(true);
    setFundingError(null);

    try {
      const preparedFunding = await prepareFundAgentVault({
        walletAddress: selectedAccount.address,
        agentName: selectedAgent.name.toLowerCase(),
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
        signedTransactionBase64: encodeBase64(signedFunding.signedTransaction),
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
      const nextMessage =
        formatUnknownError(error) || "Failed to fund agent vault.";
      setFundingError(
        nextMessage.includes("Configured fee destination")
          ? `${nextMessage} Reinitialize the vault global state on this cluster with a valid fee token account.`
          : nextMessage,
      );
    } finally {
      setIsFundingAgent(false);
    }
  };

  const handleMaxSpendSubmitCelo = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    if (!selectedAgent || !maxSpendAmount.trim()) {
      return;
    }
    const celoAddress = eco.address;
    if (!eco.isConnected || !celoAddress) {
      setMaxSpendError("Connect a Celo wallet before configuring max spendable.");
      return;
    }
    if (!GILDORE_VAULT_CELO_ADDRESS) {
      setMaxSpendError("Celo vault is not configured for this environment.");
      return;
    }

    setIsConfiguringMaxSpend(true);
    setMaxSpendError(null);

    try {
      const walletClient = await eco.getCeloWalletClient();
      if (!walletClient) {
        throw new Error("No Celo wallet available.");
      }
      const agentId = await eco.celoPublicClient.readContract({
        address: GILDORE_VAULT_CELO_ADDRESS,
        abi: GILDORE_VAULT_CELO_ABI,
        functionName: "deriveAgentId",
        args: [selectedAgent.name.toLowerCase()],
      });
      const amountBaseUnits = parseCeloDepositAmount(maxSpendAmount.trim());
      const feeCurrencyArgs = eco.isMiniPay
        ? { feeCurrency: CELO_USDC_FEE_CURRENCY_ADDRESS }
        : {};
      const { request: tickerRequest } = await eco.celoPublicClient.simulateContract({
        address: GILDORE_VAULT_CELO_ADDRESS,
        abi: GILDORE_VAULT_CELO_ABI,
        functionName: "registerTickerForMe",
        args: [agentId, amountBaseUnits],
        account: celoAddress as `0x${string}`,
      });
      const txHash = await walletClient.writeContract({
        ...tickerRequest,
        ...feeCurrencyArgs,
      } as Parameters<typeof walletClient.writeContract>[0]);

      setLastMaxSpendSignature(txHash);
      setMaxSpendAmount("");
      if (eco.isMiniPay) {
        window.open(miniPayReceiptUrl(txHash), "_top");
      }
      console.log("[register-ticker-celo] Configured max spendable:", {
        agentId: selectedAgent.id,
        marketSymbol: selectedMarketSymbol,
        amountBaseUnits: amountBaseUnits.toString(),
        txHash,
      });
    } catch (error) {
      console.error("[register-ticker-celo] failed", {
        agentId: selectedAgent.id,
        agentName: selectedAgent.name,
        marketSymbol: selectedMarketSymbol,
        amountUi: maxSpendAmount.trim(),
        address: celoAddress,
        error,
      });
      setMaxSpendError(
        formatUnknownError(error) || "Failed to configure max spendable.",
      );
    } finally {
      setIsConfiguringMaxSpend(false);
    }
  };

  const handleMaxSpendSubmit = async (event: FormEvent<HTMLFormElement>) => {
    if (isCelo) {
      return handleMaxSpendSubmitCelo(event);
    }

    event.preventDefault();
    if (!selectedAgent || !maxSpendAmount.trim()) {
      return;
    }
    if (!selectedWallet || !selectedAccount || !isConnected) {
      setMaxSpendError(
        "Connect your wallet before configuring max spendable.",
      );
      return;
    }

    setIsConfiguringMaxSpend(true);
    setMaxSpendError(null);

    try {
      const preparedTicker = await prepareRegisterTicker({
        walletAddress: selectedAccount.address,
        agentName: selectedAgent.name.toLowerCase(),
        amountUi: maxSpendAmount.trim(),
      });
      const signedTicker = await signTransaction({
        chain,
        wallet: selectedWallet,
        transaction: Uint8Array.from(
          atob(preparedTicker.transactionBase64),
          (character) => character.charCodeAt(0),
        ),
      });
      const result = await submitRegisterTicker({
        walletAddress: selectedAccount.address,
        signedTransactionBase64: encodeBase64(signedTicker.signedTransaction),
      });

      setLastMaxSpendSignature(result.signature);
      setMaxSpendAmount("");
      console.log("[register-ticker] Configured max spendable:", {
        agentId: selectedAgent.id,
        marketSymbol: selectedMarketSymbol,
        mint: preparedTicker.mint,
        amountBaseUnits: preparedTicker.amountBaseUnits,
        signature: result.signature,
      });
    } catch (error) {
      console.error("[register-ticker] failed", {
        agentId: selectedAgent.id,
        agentName: selectedAgent.name,
        marketSymbol: selectedMarketSymbol,
        amountUi: maxSpendAmount.trim(),
        chain,
        walletName: selectedWallet.standardWallet.name,
        accountAddress: selectedAccount.address,
        error,
      });
      setMaxSpendError(
        formatUnknownError(error) || "Failed to configure max spendable.",
      );
    } finally {
      setIsConfiguringMaxSpend(false);
    }
  };

  const handleWithdrawSubmitCelo = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    if (!selectedAgent || !withdrawAmount.trim()) return;
    const celoAddress = eco.address;
    if (!eco.isConnected || !celoAddress) {
      setWithdrawError("Connect a Celo wallet before withdrawing.");
      return;
    }
    if (!GILDORE_VAULT_CELO_ADDRESS) {
      setWithdrawError("Celo vault is not configured for this environment.");
      return;
    }

    setIsWithdrawing(true);
    setWithdrawError(null);

    try {
      const walletClient = await eco.getCeloWalletClient();
      if (!walletClient) throw new Error("No Celo wallet available.");

      const agentId = await eco.celoPublicClient.readContract({
        address: GILDORE_VAULT_CELO_ADDRESS,
        abi: GILDORE_VAULT_CELO_ABI,
        functionName: "deriveAgentId",
        args: [selectedAgent.name.toLowerCase()],
      });
      const amountBaseUnits = parseCeloDepositAmount(withdrawAmount.trim());
      const feeCurrencyArgs = eco.isMiniPay
        ? { feeCurrency: CELO_USDC_FEE_CURRENCY_ADDRESS }
        : {};
      const { request: withdrawRequest } = await eco.celoPublicClient.simulateContract({
        address: GILDORE_VAULT_CELO_ADDRESS,
        abi: GILDORE_VAULT_CELO_ABI,
        functionName: "withdraw",
        args: [agentId, amountBaseUnits],
        account: celoAddress as `0x${string}`,
      });
      const txHash = await walletClient.writeContract({
        ...withdrawRequest,
        ...feeCurrencyArgs,
      } as Parameters<typeof walletClient.writeContract>[0]);

      setLastWithdrawSignature(txHash);
      setWithdrawAmount("");
      if (eco.isMiniPay) {
        window.open(miniPayReceiptUrl(txHash), "_top");
      }
      console.log("[withdraw-celo] Withdrew from vault:", {
        agentId: selectedAgent.id,
        amountBaseUnits: amountBaseUnits.toString(),
        txHash,
      });
    } catch (error) {
      console.error("[withdraw-celo] failed", {
        agentId: selectedAgent.id,
        agentName: selectedAgent.name,
        amountUi: withdrawAmount.trim(),
        address: celoAddress,
        error,
      });
      setWithdrawError(formatUnknownError(error) || "Failed to withdraw.");
    } finally {
      setIsWithdrawing(false);
    }
  };

  const handleWithdrawSubmit = async (event: FormEvent<HTMLFormElement>) => {
    if (isCelo) return handleWithdrawSubmitCelo(event);

    event.preventDefault();
    if (!selectedAgent || !withdrawAmount.trim()) return;
    if (!selectedWallet || !selectedAccount || !isConnected) {
      setWithdrawError("Connect your wallet before withdrawing.");
      return;
    }

    setIsWithdrawing(true);
    setWithdrawError(null);

    try {
      const preparedWithdraw = await prepareWithdraw({
        walletAddress: selectedAccount.address,
        agentName: selectedAgent.name.toLowerCase(),
        amountUi: withdrawAmount.trim(),
      });
      const signedWithdraw = await signTransaction({
        chain,
        wallet: selectedWallet,
        transaction: Uint8Array.from(
          atob(preparedWithdraw.transactionBase64),
          (character) => character.charCodeAt(0),
        ),
      });
      const result = await submitWithdraw({
        walletAddress: selectedAccount.address,
        signedTransactionBase64: encodeBase64(signedWithdraw.signedTransaction),
      });

      setLastWithdrawSignature(result.signature);
      setWithdrawAmount("");
      console.log("[withdraw] Withdrew from vault:", {
        agentId: selectedAgent.id,
        mint: preparedWithdraw.mint,
        amountBaseUnits: preparedWithdraw.amountBaseUnits,
        signature: result.signature,
      });
    } catch (error) {
      console.error("[withdraw] failed", {
        agentId: selectedAgent.id,
        agentName: selectedAgent.name,
        amountUi: withdrawAmount.trim(),
        chain,
        walletName: selectedWallet.standardWallet.name,
        accountAddress: selectedAccount.address,
        error,
      });
      setWithdrawError(formatUnknownError(error) || "Failed to withdraw.");
    } finally {
      setIsWithdrawing(false);
    }
  };

  // ── Vault snapshot ────────────────────────────────────────────────────────
  const vaultSnapshotAgentSlug = selectedAgentSlug;
  const resolvedAgentName =
    snapshot?.agents.find((a) => a.slug === vaultSnapshotAgentSlug)?.name.toLowerCase() ??
    vaultSnapshotAgentSlug ?? "";

  const solanaSnapshotAddress = !isCelo ? (selectedAccount?.address ?? null) : null;
  const { data: solanaVaultSnapshot, isLoading: isLoadingSolanaVault } = useTanstackQuery({
    queryKey: vaultSnapshotKeys.snapshot(
      solanaSnapshotAddress ?? "",
      vaultSnapshotAgentSlug ?? "",
    ),
    queryFn: () =>
      getVaultSnapshot({
        walletAddress: solanaSnapshotAddress!,
        agentName: resolvedAgentName,
      }),
    enabled:
      !isCelo && isConnected && !!solanaSnapshotAddress && !!vaultSnapshotAgentSlug,
    staleTime: 20_000,
    refetchInterval: 30_000,
  });

  const celoSnapshotAddress = isCelo ? (eco.address ?? null) : null;
  const { data: celoVaultSnapshot, isLoading: isLoadingCeloVault } = useTanstackQuery({
    queryKey: celoVaultSnapshotKeys.snapshot(
      celoSnapshotAddress ?? "",
      vaultSnapshotAgentSlug ?? "",
    ),
    queryFn: () =>
      fetchCeloVaultSnapshot(
        eco.celoPublicClient,
        GILDORE_VAULT_CELO_ADDRESS!,
        celoSnapshotAddress! as `0x${string}`,
        resolvedAgentName,
      ),
    enabled:
      isCelo &&
      eco.isConnected &&
      !!celoSnapshotAddress &&
      !!vaultSnapshotAgentSlug &&
      !!GILDORE_VAULT_CELO_ADDRESS,
    staleTime: 20_000,
    refetchInterval: 30_000,
  });

  const vaultSnapshot = isCelo ? celoVaultSnapshot : solanaVaultSnapshot;
  const isLoadingVault = isCelo ? isLoadingCeloVault : isLoadingSolanaVault;

  // ── Celo USDC wallet balance (shown in the deposit modal) ──────────────────
  const { data: rawUsdcBalance } = useTanstackQuery({
    queryKey: celoUsdcBalanceKeys.balance(celoSnapshotAddress ?? ""),
    queryFn: async () => {
      const result = await eco.celoPublicClient.readContract({
        address: CELO_DEPOSIT_TOKEN_ADDRESS!,
        abi: MINIMAL_ERC20_ABI,
        functionName: "balanceOf",
        args: [celoSnapshotAddress! as `0x${string}`],
      });
      return result as bigint;
    },
    enabled: isCelo && !!celoSnapshotAddress && !!CELO_DEPOSIT_TOKEN_ADDRESS,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const celoUsdcBalance =
    rawUsdcBalance != null
      ? parseFloat(formatUnits(rawUsdcBalance, CELO_DEPOSIT_TOKEN_DECIMALS)).toFixed(2)
      : null;

  // ── Close position ─────────────────────────────────────────────────────────
  const handleClosePosition = async () => {
    if (!selectedAgent) return;

    setIsClosingPosition(true);
    try {
      if (isCelo) {
        const celoAddress = eco.address;
        if (!eco.isConnected || !celoAddress) return;
        await closePositionActionCelo({
          walletAddress: celoAddress,
          agentName: selectedAgent.name.toLowerCase(),
        });
      } else {
        if (!selectedWallet || !selectedAccount || !isConnected) return;
        await closePositionAction({
          walletAddress: selectedAccount.address,
          agentName: selectedAgent.name.toLowerCase(),
        });
      }
    } catch (error) {
      console.error("[close-position] failed", {
        agentId: selectedAgent.id,
        agentName: selectedAgent.name,
        error,
      });
    } finally {
      setIsClosingPosition(false);
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
      marketSyncStatus: market.marketSyncStatus ?? null,
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
      publishedAtMs: item.publishedAtMs ?? null,
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
    const selectedActiveSetupRow =
      snapshot.strategySetups?.find(
        (setup) =>
          setup.agentSlug === selectedAgent.id &&
          setup.marketSymbol === selectedMarketSymbol &&
          setup.isActive,
      ) ?? null;
    const selectedActiveSetup = selectedActiveSetupRow
      ? {
          id: String(selectedActiveSetupRow._id),
          agentSlug: selectedActiveSetupRow.agentSlug,
          marketSymbol: selectedActiveSetupRow.marketSymbol,
          state: selectedActiveSetupRow.state,
          setupType: selectedActiveSetupRow.setupType,
          direction: selectedActiveSetupRow.direction,
          regime: selectedActiveSetupRow.regime,
          confidence: selectedActiveSetupRow.confidence,
          zoneLow: selectedActiveSetupRow.zoneLow,
          zoneHigh: selectedActiveSetupRow.zoneHigh,
          projectedPrice: selectedActiveSetupRow.projectedPrice,
          invalidationLow: selectedActiveSetupRow.invalidationLow,
          invalidationHigh: selectedActiveSetupRow.invalidationHigh,
          invalidationNote: selectedActiveSetupRow.invalidationNote,
          t1Price: selectedActiveSetupRow.t1Price,
          t1Date: selectedActiveSetupRow.t1Date,
          t2Price: selectedActiveSetupRow.t2Price,
          t2Date: selectedActiveSetupRow.t2Date,
          rationaleSummary: selectedActiveSetupRow.rationaleSummary,
          createdAt: selectedActiveSetupRow.createdAt,
          lastReviewedAt: selectedActiveSetupRow.lastReviewedAt,
          entryPrice: selectedActiveSetupRow.entryPrice,
          stopPrice: selectedActiveSetupRow.stopPrice,
          targetPrice: selectedActiveSetupRow.targetPrice,
          entryTriggeredAt: selectedActiveSetupRow.entryTriggeredAt,
          completedAt: selectedActiveSetupRow.completedAt,
          parentSetupId: selectedActiveSetupRow.parentSetupId
            ? String(selectedActiveSetupRow.parentSetupId)
            : undefined,
          isActive: selectedActiveSetupRow.isActive,
        }
      : null;
    const selectedAnalysisSchedule =
      snapshot.analysisSchedules?.find(
        (schedule) =>
          schedule.agentSlug === selectedAgent.id &&
          schedule.marketSymbol === selectedMarketSymbol,
      ) ?? null;
    const selectedAnalysisRenderCache =
      snapshot.analysisRenderCaches?.find(
        (cache) =>
          cache.agentSlug === selectedAgent.id &&
          cache.marketSymbol === selectedMarketSymbol,
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
      selectedActiveSetup,
      selectedAnalysisSchedule,
      selectedAnalysisRenderCache,
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

  const isInitialLoading = !snapshot || !derived;

  if (!isInitialLoading && !derived.selectedAgent && !derived.agents?.length) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.07),transparent_24%),radial-gradient(circle_at_top,rgba(255,255,255,0.03),transparent_32%),linear-gradient(180deg,#050506_0%,#0b0b0d_46%,#111215_100%)] text-[#f5f5f5]">
        <section className="w-full max-w-[1280px] mx-auto px-3 sm:px-6 pt-8 pb-16">
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

  const agents = derived?.agents ?? [];
  const positions = derived?.positions ?? [];
  const trackedMarkets = derived?.trackedMarkets ?? [];
  const selectedAgent = derived?.selectedAgent ?? null;
  const selectedMarketSymbol = derived?.selectedMarketSymbol;
  const selectedTradeIdea = derived?.selectedTradeIdea;
  const selectedTrace = derived?.selectedTrace;
  const selectedEvents = derived?.selectedEvents ?? [];
  const selectedWatchlist = derived?.selectedWatchlist ?? [];
  const selectedPosition = derived?.selectedPosition;
  const selectedNewsContexts = derived?.selectedNewsContexts ?? [];
  const selectedNewsRationale = derived?.selectedNewsRationale;
  const selectedBrowserSession = derived?.selectedBrowserSession;
  const selectedVisionDecision = derived?.selectedVisionDecision;
  const selectedActiveSetup = derived?.selectedActiveSetup;
  const selectedAnalysisSchedule = derived?.selectedAnalysisSchedule;
  const selectedAnalysisRenderCache = derived?.selectedAnalysisRenderCache;

  const handleToggleAgent = (agentId: string) => {
    if (selectedAgent?.id === agentId) {
      router.replace("/arena", {
        scroll: false,
      });
      return;
    }

    const nextAgent = agents.find((agent) => agent.id === agentId);
    const nextMarketSymbol = nextAgent?.primaryMarket;

    router.replace(
      nextMarketSymbol
        ? `/arena?agent=${agentId}&market=${encodeURIComponent(nextMarketSymbol)}`
        : `/arena?agent=${agentId}`,
      {
        scroll: false,
      },
    );
  };

  const handleSelectMarket = (marketSymbol: string) => {
    router.replace(
      `/arena?agent=${selectedAgent?.id}&market=${encodeURIComponent(marketSymbol)}`,
      {
        scroll: false,
      },
    );
  };

  const handleOpenPrediction = () => {
    console.log(
      "[prediction] Enter Prediction clicked for agent:",
      selectedAgent?.id,
    );
  };

  async function launchBrowserSession(options?: { forceNew?: boolean }) {
    if (!selectedAgent || !selectedMarketSymbol) {
      return;
    }

    setRevealedConjureSelectionKey(selectedConjureKey);
    if (!options?.forceNew) {
      setAutoRestartedConjureSelectionKey(null);
    }
    if (selectedBrowserSession && !options?.forceNew) return;

    setIsStartingBrowserSession(true);
    try {
      const hasCachedConjurePayload =
        selectedAgent.id === "third-touch" &&
        selectedAnalysisRenderCache &&
        selectedAnalysisRenderCache.direction !== "none" &&
        selectedAnalysisRenderCache.t1Price !== undefined &&
        selectedAnalysisRenderCache.t2Price !== undefined &&
        selectedAnalysisRenderCache.zoneLow !== undefined &&
        selectedAnalysisRenderCache.zoneHigh !== undefined &&
        selectedAnalysisRenderCache.projectedPrice !== undefined;

      const shouldRefreshCachedAnalysis =
        selectedAnalysisSchedule &&
        selectedAnalysisSchedule.nextReviewAt <= Date.now();

      if (shouldRefreshCachedAnalysis) {
        void requestAnalysisRefresh({
          agentSlug: selectedAgent.id,
          marketSymbol: selectedMarketSymbol,
          timeframe: selectedAgent.timeframe,
          trigger: "manual",
        }).catch((error) => {
          console.warn("[conjure] failed to enqueue refresh", error);
        });
      }

      const result = await startBrowserReviewSession({
        agentSlug: selectedAgent.id,
        marketSymbol: selectedMarketSymbol,
        timeframe: selectedAgent.timeframe,
      });

      const isFibAgent = selectedAgent.id === "fibonacci-trend";
      let response: Response;

      if (isFibAgent) {
        const { legs, preferredZone } = extractFibonacciLegs(selectedTrace);
        response = await fetch("/api/browser-session/fibonacci/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: result.sessionId,
            agentSlug: selectedAgent.id,
            agentMarketSymbol: selectedMarketSymbol,
            marketSymbol: result.browserTargetSymbol,
            timeframe: result.browserTargetTimeframe,
            targetUrl: "https://charts.deriv.com/deriv",
            legs,
            preferredZone,
            direction: selectedTradeIdea?.direction ?? "long",
          }),
        });
      } else {
        const endpoint = hasCachedConjurePayload
          ? "/api/browser-session/render/start"
          : "/api/browser-session/start";
        response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: result.sessionId,
            marketSymbol: result.browserTargetSymbol,
            timeframe: result.browserTargetTimeframe,
            agentSlug: selectedAgent.id,
            agentMarketSymbol: selectedMarketSymbol,
            targetUrl: "https://charts.deriv.com/deriv",
            swingPoints:
              !hasCachedConjurePayload &&
              result.browserTargetSymbol === selectedMarketSymbol
                ? extractSwingPoints(selectedTrace, selectedAgent.timeframe)
                : undefined,
            overlay: hasCachedConjurePayload
              ? {
                  structureStatus: selectedAnalysisRenderCache.structureStatus,
                  verdict: selectedAnalysisRenderCache.verdict,
                  direction: selectedAnalysisRenderCache.direction,
                  t1Price: selectedAnalysisRenderCache.t1Price,
                  t1Date: selectedAnalysisRenderCache.t1Date,
                  t2Price: selectedAnalysisRenderCache.t2Price,
                  t2Date: selectedAnalysisRenderCache.t2Date,
                  zoneLow: selectedAnalysisRenderCache.zoneLow,
                  zoneHigh: selectedAnalysisRenderCache.zoneHigh,
                  projectedPrice: selectedAnalysisRenderCache.projectedPrice,
                  invalidationLow: selectedAnalysisRenderCache.invalidationLow,
                  invalidationHigh:
                    selectedAnalysisRenderCache.invalidationHigh,
                  invalidationNote:
                    selectedAnalysisRenderCache.invalidationNote,
                }
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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.07),transparent_24%),radial-gradient(circle_at_top,rgba(255,255,255,0.03),transparent_32%),linear-gradient(180deg,#050506_0%,#0b0b0d_46%,#111215_100%)] text-[#f5f5f5]">
      <section className="w-full max-w-[1280px] mx-auto px-3 sm:px-6 pt-8 pb-16">
        <header className="grid grid-cols-1 gap-6 items-start md:grid-cols-[minmax(0,1.8fr)_minmax(280px,0.9fr)]">
          <div>
            <Link
              href="/"
              className="inline-flex min-h-[40px] items-center gap-2 mb-[18px] font-barlow text-[12px] font-semibold uppercase tracking-[0.14em] text-[rgba(245,245,245,0.62)] no-underline transition-colors hover:text-[#f5f5f5]"
            >
              <ArrowLeft aria-hidden="true" size={16} />
              Back to landing
            </Link>

            <div className="font-barlow underline text-xl font-normal leading-[0.95] mb-3">
              Season Zer0
            </div>

            <h1 className="max-w-[14ch] whitespace-nowrap m-0 text-[clamp(32px,8vw,48px)] font-normal leading-[0.96] tracking-[-0.5px] font-instrument">
              Fire your Fund Manager
            </h1>
            <p className="mt-5 mb-0 max-w-[60ch] font-inter text-[16px] leading-[1.7] text-[rgba(245,245,245,0.62)]">
              replace blind trust with visible, competitive, machine-disciplined
              trading performance.
            </p>
          </div>

          <div className="flex gap-[10px] flex-row max-h-24">
            <SignInCard />
          </div>
        </header>

        <section className="mt-6 overflow-x-auto" aria-label="Arena leaderboard">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-white/10">
                <th className="whitespace-nowrap px-2 py-2 text-left font-barlow text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(245,245,245,0.42)] md:px-3.5">
                  #
                </th>
                <th className="whitespace-nowrap px-2 py-2 text-left font-barlow text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(245,245,245,0.42)] md:px-3.5">
                  Agent
                </th>
                <th className="hidden whitespace-nowrap px-2 py-2 text-left font-barlow text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(245,245,245,0.42)] md:table-cell md:px-3.5">
                  Strategy
                </th>
                <th className="whitespace-nowrap px-2 py-2 text-left font-barlow text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(245,245,245,0.42)] md:px-3.5">
                  Status
                </th>
                <th className="whitespace-nowrap px-2 py-2 text-left font-barlow text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(245,245,245,0.42)] md:px-3.5">
                  Win rate
                </th>
                <th className="whitespace-nowrap px-2 py-2 text-left font-barlow text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(245,245,245,0.42)] md:px-3.5">
                  PnL
                </th>
                <th className="hidden whitespace-nowrap px-2 py-2 text-left font-barlow text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(245,245,245,0.42)] md:table-cell md:px-3.5">
                  Positions
                </th>
                <th className="hidden whitespace-nowrap px-2 py-2 text-left font-barlow text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(245,245,245,0.42)] md:table-cell md:px-3.5">
                  Markets
                </th>
                <th className="hidden whitespace-nowrap px-2 py-2 text-left font-barlow text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(245,245,245,0.42)] sm:table-cell md:px-3.5">
                  Score
                </th>
              </tr>
            </thead>
            <tbody>
              {isInitialLoading
                ? [1, 2, 3].map((row) => (
                    <tr
                      key={row}
                      className="border-b border-white/8"
                    >
                      <td className="px-2 md:px-3.5 py-[13px] align-middle">
                        <div className={cn(skelBase, "w-[24px] h-[14px]")} />
                      </td>
                      <td className="px-2 md:px-3.5 py-[13px] align-middle">
                        <div className={cn(skelBase, "w-[90px] h-[15px]")} />
                      </td>
                      <td className="hidden px-2 md:px-3.5 py-[13px] align-middle md:table-cell">
                        <div className={cn(skelBase, "w-[160px] h-[14px]")} />
                      </td>
                      <td className="px-2 md:px-3.5 py-[13px] align-middle">
                        <div
                          className={cn(
                            skelBase,
                            "inline-block w-[72px] h-[24px] rounded-[20px]",
                          )}
                        />
                      </td>
                      <td className="px-2 md:px-3.5 py-[13px] align-middle">
                        <div className={cn(skelBase, "w-[44px] h-[14px]")} />
                      </td>
                      <td className="px-2 md:px-3.5 py-[13px] align-middle">
                        <div className={cn(skelBase, "w-[44px] h-[14px]")} />
                      </td>
                      <td className="hidden px-2 md:px-3.5 py-[13px] align-middle md:table-cell">
                        <div className={cn(skelBase, "w-[44px] h-[14px]")} />
                      </td>
                      <td className="hidden px-2 md:px-3.5 py-[13px] align-middle md:table-cell">
                        <div className={cn(skelBase, "w-[44px] h-[14px]")} />
                      </td>
                      <td className="hidden px-2 md:px-3.5 py-[13px] align-middle sm:table-cell">
                        <div
                          className={cn(
                            skelBase,
                            "w-[48px] h-[20px] rounded-[4px]",
                          )}
                        />
                      </td>
                    </tr>
                  ))
                : agents.map((agent, index) => {
                const isSelected = agent.id === selectedAgent?.id;
                const expandedAgent = isSelected ? selectedAgent : null;
                const expandedMarketSymbol = isSelected
                  ? selectedMarketSymbol
                  : undefined;
                const agentPositions = positions.filter(
                  (p) => p.agentId === agent.id,
                );
                return (
                  <Fragment key={agent.id}>
                    <tr
                      key={agent.id}
                      className={cn(
                        "cursor-pointer border-b border-white/8 transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-inset",
                        isSelected && "bg-white/[0.06]",
                      )}
                      onClick={() => handleToggleAgent(agent.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          handleToggleAgent(agent.id);
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      aria-expanded={isSelected}
                      aria-controls={`agent-detail-${agent.id}`}
                    >
                      <td className="w-9 px-2 py-[13px] align-middle font-barlow text-[12px] text-[rgba(245,245,245,0.35)] md:px-3.5">
                        {String(index + 1).padStart(2, "0")}
                      </td>
                      <td className="px-2 md:px-3.5 py-[13px] align-middle">
                        <div className="flex items-center gap-3">
                          <ChevronDown
                            aria-hidden="true"
                            size={16}
                            className={cn(
                              "text-[rgba(245,245,245,0.42)] transition-transform duration-200",
                              isSelected && "rotate-180",
                            )}
                          />
                          <strong className="font-barlow text-[14px] font-semibold">
                            {agent.name}
                          </strong>
                        </div>
                      </td>
                      <td className="hidden px-2 py-[13px] align-middle font-inter text-[13px] text-[rgba(245,245,245,0.55)] md:table-cell md:px-3.5">
                        {agent.strategyLabel}
                      </td>
                      <td className="px-2 md:px-3.5 py-[13px] align-middle">
                        <span className={cn(chipClass, "font-barlow")}>
                          {statusLabelMap[agent.status]}
                        </span>
                      </td>
                      <td className="px-2 md:px-3.5 py-[13px] align-middle font-barlow">
                        {agent.winRate}%
                      </td>
                      <td
                        className={cn(
                          "px-2 md:px-3.5 py-[13px] align-middle font-barlow",
                          agent.pnlPercent >= 0
                            ? "text-[#1a7f46]"
                            : "text-[#a33030]",
                        )}
                      >
                        {agent.pnlPercent >= 0 ? "+" : ""}
                        {agent.pnlPercent.toFixed(1)}%
                      </td>
                      <td className="hidden px-2 md:px-3.5 py-[13px] align-middle font-barlow md:table-cell">
                        {agentPositions.length}
                      </td>
                      <td className="hidden px-2 md:px-3.5 py-[13px] align-middle font-barlow md:table-cell">
                        {agent.trackedMarkets.length}
                      </td>
                      <td className="hidden px-2 md:px-3.5 py-[13px] align-middle text-[18px] font-normal text-right font-instrument sm:table-cell">
                        {agent.score}
                      </td>
                    </tr>
                    {isSelected && expandedAgent && expandedMarketSymbol ? (
                      <tr
                        id={`agent-detail-${agent.id}`}
                        key={`${agent.id}-detail`}
                        className="border-b border-white/8"
                      >
                        <td colSpan={9} className="px-0 pb-5 pt-0">
                          <div className="shadow-[0_24px_70px_rgba(0,0,0,0.24)]">
                            <SelectedAgentPanel
                              className="mt-0"
                              agents={agents.map((agent) => ({
                                id: agent.id,
                                score: agent.score,
                              }))}
                              selectedAgent={expandedAgent}
                              selectedMarketSymbol={expandedMarketSymbol}
                              trackedMarkets={trackedMarkets}
                              selectedTradeIdea={selectedTradeIdea}
                              selectedPosition={selectedPosition}
                              selectedTrace={selectedTrace}
                              selectedWatchlist={selectedWatchlist}
                              selectedEvents={selectedEvents}
                              selectedNewsContexts={selectedNewsContexts}
                              selectedNewsRationale={
                                selectedNewsRationale ?? ""
                              }
                              selectedBrowserSession={
                                selectedBrowserSession ?? null
                              }
                              selectedVisionDecision={
                                selectedVisionDecision ?? null
                              }
                              selectedActiveSetup={selectedActiveSetup ?? null}
                              isWideWorkspace={isWideWorkspace}
                              conjureDitheringSize={conjureDitheringSize}
                              isConjureRevealed={
                                revealedConjureSelectionKey ===
                                selectedConjureKey
                              }
                              isConjureLoading={
                                revealedConjureSelectionKey ===
                                  selectedConjureKey &&
                                !selectedBrowserSession &&
                                isStartingBrowserSession
                              }
                              autoRestartedConjureSelectionKey={
                                autoRestartedConjureSelectionKey
                              }
                              conjureSelectionKey={selectedConjureKey ?? ""}
                              onSelectMarket={handleSelectMarket}
                              onOpenFundingModal={() =>
                                setIsSubscribeModalOpen(true)
                              }
                              onOpenPrediction={handleOpenPrediction}
                              spendAmount={maxSpendAmount}
                              onSpendAmountChange={setMaxSpendAmount}
                              onSubmitMaxSpend={handleMaxSpendSubmit}
                              isConfiguringMaxSpend={isConfiguringMaxSpend}
                              maxSpendError={maxSpendError}
                              lastMaxSpendSignature={lastMaxSpendSignature}
                              isConnected={isCelo ? eco.isConnected : isConnected}
                              onRevealBrowserSession={() =>
                                launchBrowserSession()
                              }
                              onForceRestartBrowserSession={() =>
                                launchBrowserSession({ forceNew: true })
                              }
                              onResetBrowserSessionPanel={() => {
                                setRevealedConjureSelectionKey(null);
                                setAutoRestartedConjureSelectionKey(null);
                                setIsStartingBrowserSession(false);
                              }}
                              onMarkAutoRestarted={() =>
                                setAutoRestartedConjureSelectionKey(
                                  selectedConjureKey,
                                )
                              }
                              vaultBalance={vaultSnapshot?.vaultBalance ?? null}
                              vaultAllowance={vaultSnapshot?.vaultAllowance ?? null}
                              isInPosition={vaultSnapshot?.isInPosition ?? null}
                              vaultDecimals={vaultSnapshot?.decimals ?? 6}
                              isLoadingVault={isLoadingVault}
                              withdrawAmount={withdrawAmount}
                              onWithdrawAmountChange={setWithdrawAmount}
                              onSubmitWithdraw={handleWithdrawSubmit}
                              isWithdrawing={isWithdrawing}
                              withdrawError={withdrawError}
                              lastWithdrawSignature={lastWithdrawSignature}
                              onClosePosition={() => void handleClosePosition()}
                              isClosingPosition={isClosingPosition}
                            />
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </section>
      </section>
      {selectedAgent ? (
        <AgentFundingModal
          agentName={selectedAgent.name}
          isOpen={isSubscribeModalOpen}
          isConnected={isCelo ? eco.isConnected : isConnected}
          depositAmount={depositAmount}
          depositTokenBalance={isCelo ? celoUsdcBalance : null}
          fundingError={fundingError}
          lastFundingSignature={lastFundingSignature}
          isFundingAgent={isFundingAgent}
          onClose={() => setIsSubscribeModalOpen(false)}
          onDepositAmountChange={setDepositAmount}
          onSubmit={handleSubscribeSubmit}
        />
      ) : null}
      <footer className="w-full py-6 text-center">
        <div className="flex items-center justify-center gap-6">
          <a
            href="/terms"
            target="_top"
            className="font-barlow text-[11px] text-[rgba(247,239,231,0.36)] underline-offset-2 hover:text-[rgba(247,239,231,0.6)] hover:underline"
          >
            Terms of Service
          </a>
          <a
            href="/privacy"
            target="_top"
            className="font-barlow text-[11px] text-[rgba(247,239,231,0.36)] underline-offset-2 hover:text-[rgba(247,239,231,0.6)] hover:underline"
          >
            Privacy Policy
          </a>
        </div>
      </footer>
    </main>
  );
}
