"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import {
  Activity,
  ArrowLeft,
  Eye,
  ExternalLink,
  LineChart,
  LoaderCircle,
  Newspaper,
  Radar,
  RefreshCcw,
  Trophy,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import TradingViewWorkspace from "@/components/tradingview-workspace";
import type {
  Position,
  TradeEvent,
  TradeIdea,
  VisualTrace,
  WatchlistItem,
} from "@/lib/arena-types";

const statusLabelMap = {
  scanning: "Scanning",
  watchlist: "Watchlist",
  ready: "Ready",
  entered: "Entered",
  monitoring: "Monitoring",
  closed: "Closed",
} as const;

const confluenceToneMap = {
  supportive: "Supportive",
  neutral: "Neutral",
  risk: "Risk",
} as const;

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

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="arena-empty-state">
      <strong className="font-barlow">{title}</strong>
      <span className="font-inter">{description}</span>
    </div>
  );
}

function formatRelativeMinutes(timestamp: number | null) {
  if (!timestamp) return "Not yet run";

  const deltaSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}m ago`;
  return `${Math.floor(deltaSeconds / 3600)}h ago`;
}

function formatNewsFreshness(timestamp: number | null) {
  if (!timestamp) return "news stale";

  const deltaSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (deltaSeconds < 3600) return `${Math.max(1, Math.floor(deltaSeconds / 60))}m`;
  if (deltaSeconds < 86400) return `${Math.floor(deltaSeconds / 3600)}h`;
  return `${Math.floor(deltaSeconds / 86400)}d`;
}

export default function ArenaDashboard() {
  const searchParams = useSearchParams();
  const snapshot = useQuery(api.arena.getArenaSnapshot, {});
  const runArenaScanCycleNow = useAction(api.arena.runArenaScanCycleNow);
  const [isRunningScan, setIsRunningScan] = useState(false);

  const selectedAgentSlug = searchParams.get("agent");
  const selectedMarketParam = searchParams.get("market");

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

    const watchlistItems: WatchlistItem[] = snapshot.watchlistItems.map((item) => ({
      id: String(item._id),
      agentId: item.agentSlug,
      marketSymbol: item.marketSymbol,
      setupLabel: item.setupLabel,
      timeframe: item.timeframe,
      status: item.status,
      triggerNote: item.triggerNote,
      confluenceState: item.confluenceState,
    }));

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
      timestamp: event.timestampLabel,
      title: event.title,
      detail: event.detail,
      stage: event.stage,
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

    const selectedAgent = agents.find((agent) => agent.id === selectedAgentSlug) ?? agents[0];
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
        idea.agentId === selectedAgent.id && idea.marketSymbol === selectedMarketSymbol,
    );
    const selectedTrace = visualTraces.find(
      (trace) =>
        trace.agentId === selectedAgent.id && trace.marketSymbol === selectedMarketSymbol,
    );
    const selectedEvents = tradeEvents.filter(
      (event) =>
        event.agentId === selectedAgent.id && event.marketSymbol === selectedMarketSymbol,
    );
    const selectedWatchlist = watchlistItems.filter(
      (item) =>
        item.agentId === selectedAgent.id && item.marketSymbol === selectedMarketSymbol,
    );
    const selectedPosition = positions.find(
      (position) =>
        position.agentId === selectedAgent.id &&
        position.marketSymbol === selectedMarketSymbol,
    );
    const selectedNewsContexts = newsContexts.filter(
      (item) =>
        item.marketSymbol === selectedMarketSymbol &&
        (item.agentSlug === null || item.agentSlug === selectedAgent.id),
    ).slice(0, 4);
    const selectedNewsRationale = selectedNewsContexts[0]?.rationale ?? "";
    const selectedAgentOpenPositions = positions.filter(
      (position) => position.agentId === selectedAgent.id,
    ).length;

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
      lastScanAt: snapshot.scanRuns[0]?.startedAt ?? null,
    };
  }, [selectedAgentSlug, selectedMarketParam, snapshot]);

  if (!snapshot || !derived) {
    return (
      <main className="arena-dashboard">
        <section className="arena-dashboard-shell">
          <div className="arena-surface arena-loading-surface">
            <LoaderCircle aria-hidden="true" className="arena-spin" size={20} />
            <div>
              <strong className="font-barlow">Loading arena state</strong>
              <p className="font-inter">
                Loading agents, traces, markets, and current arena activity.
              </p>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (!derived.selectedAgent) {
    return (
      <main className="arena-dashboard">
        <section className="arena-dashboard-shell">
          <div className="arena-surface">
            <div className="arena-surface-header">
              <div className="arena-surface-title">
                <Radar aria-hidden="true" size={18} />
                <h2 className="font-barlow">Arena state</h2>
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
    trackedMarkets,
    selectedAgent,
    selectedMarketSymbol,
    selectedTradeIdea,
    selectedTrace,
    selectedEvents,
    selectedWatchlist,
    selectedPosition,
    selectedNewsContexts,
    selectedNewsRationale,
    lastScanAt,
  } = derived;
  const selectedMarket = trackedMarkets.find(
    (market) => market.symbol === selectedMarketSymbol,
  );

  return (
    <main className="arena-dashboard">
      <section className="arena-dashboard-shell">
        <header className="arena-dashboard-header">
          <div>
            <Link href="/" className="arena-back-link font-barlow">
              <ArrowLeft aria-hidden="true" size={16} />
              Back to landing
            </Link>
            <p className="arena-kicker font-barlow">Arena season zero</p>
            <h1 className="arena-dashboard-title font-instrument">
              Strategy agents tracking structure, confluence, and execution state.
            </h1>
            <p className="arena-dashboard-intro font-inter">
              Monitor active agents, watched markets, chart annotations, and staged
              trade logic as the arena evolves across each symbol.
            </p>
          </div>

          <div className="arena-status-strip">
            <div className="arena-status-card">
              <span className="font-barlow">Season</span>
              <strong className="font-instrument">S0</strong>
            </div>
            <div className="arena-status-card">
              <span className="font-barlow">Agents live</span>
              <strong className="font-instrument">{agents.length}</strong>
            </div>
            <div className="arena-status-card">
              <span className="font-barlow">Last scan</span>
              <strong className="font-instrument">
                {formatRelativeMinutes(lastScanAt)}
              </strong>
            </div>
            <button
              className={`arena-status-card arena-scan-trigger${isRunningScan ? " is-running" : ""}`}
              type="button"
              onClick={async () => {
                setIsRunningScan(true);
                try {
                  await runArenaScanCycleNow({});
                } finally {
                  setIsRunningScan(false);
                }
              }}
              disabled={isRunningScan}
            >
              <span className="font-barlow">Dev scan</span>
              <strong className="font-instrument">
                {isRunningScan ? "Running..." : "Run now"}
              </strong>
              <RefreshCcw
                aria-hidden="true"
                size={16}
                className={isRunningScan ? "arena-spin" : ""}
              />
            </button>
          </div>
        </header>

        <section className="arena-dashboard-grid" aria-label="Arena overview">
          <article className="arena-surface arena-leaderboard-card">
            <div className="arena-surface-header">
              <div className="arena-surface-title">
                <Trophy aria-hidden="true" size={18} />
                <h2 className="font-barlow">Leaderboard</h2>
              </div>
              <span className="arena-chip font-barlow">Points</span>
            </div>
            <div className="arena-agent-list">
              {agents.map((agent, index) => {
                const isSelected = agent.id === selectedAgent.id;

                return (
                  <Link
                    key={agent.id}
                    href={`/arena?agent=${agent.id}`}
                    className={`arena-agent-row${isSelected ? " is-selected" : ""}`}
                  >
                    <div className="arena-agent-rank font-barlow">
                      {String(index + 1).padStart(2, "0")}
                    </div>
                    <div className="arena-agent-main">
                      <strong className="font-barlow">{agent.name}</strong>
                      <span className="font-inter">
                        {agent.primaryMarket} · {agent.strategyLabel}
                      </span>
                    </div>
                    <div className="arena-agent-meta">
                      <span className="font-barlow">
                        {statusLabelMap[agent.status]}
                      </span>
                      <strong className="font-instrument">{agent.score}</strong>
                    </div>
                  </Link>
                );
              })}
            </div>
          </article>

          <article className="arena-surface">
            <div className="arena-surface-header">
              <div className="arena-surface-title">
                <Radar aria-hidden="true" size={18} />
                <h2 className="font-barlow">Watched markets</h2>
              </div>
              <span className="arena-chip font-barlow">
                {trackedMarkets.length} tracked
              </span>
            </div>
            <div className="arena-market-list">
              {trackedMarkets.map((market) => {
                const roleLabels = getMarketRoles({
                  marketSymbol: market.symbol,
                  primaryMarket: selectedAgent.primaryMarket,
                  hasWatchlist: selectedWatchlist.some(
                    (item) => item.marketSymbol === market.symbol,
                  ),
                  hasPosition: positions.some(
                    (position) =>
                      position.agentId === selectedAgent.id &&
                      position.marketSymbol === market.symbol,
                  ),
                });

                return (
                  <Link
                    key={market.symbol}
                    href={`/arena?agent=${selectedAgent.id}&market=${encodeURIComponent(
                      market.symbol,
                    )}`}
                    className={`arena-market-row arena-market-row-tone-${market.newsState}${
                      market.symbol === selectedMarketSymbol ? " is-selected" : ""
                    }`}
                  >
                    <div>
                      <strong className="font-barlow">{market.symbol}</strong>
                      <span className="font-inter">
                        {market.displayName}
                        {roleLabels.length ? ` · ${roleLabels.join(" · ")}` : ""}
                      </span>
                    </div>
                    <div>
                      <div className="arena-market-meta-top">
                        <span className={`arena-pill is-${market.newsState} font-barlow`}>
                          {confluenceToneMap[market.newsState]}
                        </span>
                        <span className="arena-market-freshness font-barlow">
                          {formatNewsFreshness(market.newsUpdatedAt)}
                        </span>
                      </div>
                      <strong className="font-barlow">{market.price}</strong>
                      <span
                        className={`font-inter ${
                          market.changePercent >= 0 ? "is-positive" : "is-negative"
                        }`}
                      >
                        {market.changePercent >= 0 ? "+" : ""}
                        {market.changePercent.toFixed(2)}%
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </article>

          <article className="arena-surface">
            <div className="arena-surface-header">
              <div className="arena-surface-title">
                <Activity aria-hidden="true" size={18} />
                <h2 className="font-barlow">Open positions</h2>
              </div>
              <span className="arena-chip font-barlow">
                {positions.length} active
              </span>
            </div>
            <div className="arena-position-list">
              {positions.map((position) => (
                <div key={position.id} className="arena-position-row">
                  <div>
                    <strong className="font-barlow">
                      {position.marketSymbol} · {position.direction}
                    </strong>
                    <span className="font-inter">
                      Entry {position.entry} · Mark {position.markPrice}
                    </span>
                  </div>
                  <div>
                    <strong
                      className={`font-barlow ${
                        position.pnlPercent >= 0 ? "is-positive" : "is-negative"
                      }`}
                    >
                      {position.pnlPercent >= 0 ? "+" : ""}
                      {position.pnlPercent.toFixed(2)}%
                    </strong>
                    <span className="font-inter">{position.nextCheckIn}</span>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="arena-surface">
            <div className="arena-surface-header">
              <div className="arena-surface-title">
                <LineChart aria-hidden="true" size={18} />
                <h2 className="font-barlow">Recent decisions</h2>
              </div>
              <span className="arena-chip font-barlow">{tradeEvents.length} logs</span>
            </div>
            <div className="arena-event-list">
              {tradeEvents.slice(-4).reverse().map((event) => (
                <div key={event.id} className="arena-event-row">
                  <span className="arena-event-time font-barlow">
                    {event.timestamp}
                  </span>
                  <div>
                    <strong className="font-barlow">{event.title}</strong>
                    <span className="font-inter">{event.detail}</span>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="arena-detail-layout" aria-label="Selected agent detail">
          <article className="arena-surface arena-detail-primary">
            <div className="arena-detail-header">
              <div>
                <p className="arena-kicker font-barlow">Selected agent</p>
                <h2 className="font-instrument">{selectedAgent.name}</h2>
                <p className="font-inter">{selectedAgent.lastAction}</p>
              </div>
              <div className="arena-detail-badges">
                <span className="arena-chip font-barlow">
                  {selectedMarketSymbol}
                </span>
                {selectedMarket ? (
                  <>
                    <span className={`arena-pill is-${selectedMarket.newsState} font-barlow`}>
                      {confluenceToneMap[selectedMarket.newsState]}
                    </span>
                    <span className="arena-chip font-barlow">
                      News {formatNewsFreshness(selectedMarket.newsUpdatedAt)}
                    </span>
                  </>
                ) : null}
                <span className="arena-chip font-barlow">
                  {statusLabelMap[selectedAgent.status]}
                </span>
                <span className="arena-chip font-barlow">
                  {selectedAgent.timeframe}
                </span>
              </div>
            </div>

            <div className="arena-market-switcher" aria-label="Tracked markets">
              {trackedMarkets.map((market) => {
                const isActive = market.symbol === selectedMarketSymbol;
                const roleLabels = getMarketRoles({
                  marketSymbol: market.symbol,
                  primaryMarket: selectedAgent.primaryMarket,
                  hasWatchlist: selectedWatchlist.some(
                    (item) => item.marketSymbol === market.symbol,
                  ),
                  hasPosition: positions.some(
                    (position) =>
                      position.agentId === selectedAgent.id &&
                      position.marketSymbol === market.symbol,
                  ),
                });

                return (
                  <Link
                    key={market.symbol}
                    href={`/arena?agent=${selectedAgent.id}&market=${encodeURIComponent(
                      market.symbol,
                    )}`}
                    className={`arena-market-pill arena-market-pill-tone-${market.newsState}${
                      isActive ? " is-active" : ""
                    }`}
                  >
                    <strong className="font-barlow">{market.symbol}</strong>
                    <span className="font-inter">
                      {market.displayName}
                      {roleLabels.length ? ` · ${roleLabels.join(" · ")}` : ""}
                    </span>
                    <div className="arena-market-pill-meta">
                      <span className={`arena-pill is-${market.newsState} font-barlow`}>
                        {confluenceToneMap[market.newsState]}
                      </span>
                      <span className="arena-market-freshness font-barlow">
                        {formatNewsFreshness(market.newsUpdatedAt)}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>

            <div className="arena-stat-grid">
              <div className="arena-stat-card">
                <span className="font-barlow">Win rate</span>
                <strong className="font-instrument">{selectedAgent.winRate}%</strong>
              </div>
              <div className="arena-stat-card">
                <span className="font-barlow">Arena PnL</span>
                <strong className="font-instrument">
                  {selectedAgent.pnlPercent > 0 ? "+" : ""}
                  {selectedAgent.pnlPercent.toFixed(1)}%
                </strong>
              </div>
              <div className="arena-stat-card">
                <span className="font-barlow">Open positions</span>
                <strong className="font-instrument">
                  {selectedAgent.openPositions}
                </strong>
              </div>
              <div className="arena-stat-card">
                <span className="font-barlow">Next check</span>
                <strong className="font-instrument">
                  {selectedPosition?.nextCheckIn ?? "Waiting"}
                </strong>
              </div>
            </div>

            {selectedTradeIdea ? (
              <div className="arena-idea-card">
                <div className="arena-surface-header">
                  <div className="arena-surface-title">
                    <Eye aria-hidden="true" size={18} />
                    <h3 className="font-barlow">Current trade idea</h3>
                  </div>
                  <span className="arena-chip font-barlow">
                    {confluenceToneMap[selectedTradeIdea.confluenceState]}
                  </span>
                </div>
                <p className="font-inter">{selectedTradeIdea.thesis}</p>
                <div className="arena-level-grid">
                  <div>
                    <span className="font-barlow">Entry</span>
                    <strong className="font-instrument">
                      {selectedTradeIdea.entry}
                    </strong>
                  </div>
                  <div>
                    <span className="font-barlow">Stop loss</span>
                    <strong className="font-instrument">
                      {selectedTradeIdea.stopLoss}
                    </strong>
                  </div>
                  <div>
                    <span className="font-barlow">Take profit</span>
                    <strong className="font-instrument">
                      {selectedTradeIdea.takeProfit}
                    </strong>
                  </div>
                  <div>
                    <span className="font-barlow">Confidence</span>
                    <strong className="font-instrument">
                      {Math.round(selectedTradeIdea.confidence * 100)}%
                    </strong>
                  </div>
                </div>
              </div>
            ) : (
              <div className="arena-idea-card">
                <div className="arena-surface-header">
                  <div className="arena-surface-title">
                    <Eye aria-hidden="true" size={18} />
                    <h3 className="font-barlow">Current trade idea</h3>
                  </div>
                </div>
                <EmptyState
                  title="No active idea for this market"
                  description="The selected agent is tracking this symbol, but it has not promoted a setup into an active trade idea yet."
                />
              </div>
            )}

            <TradingViewWorkspace
              marketSymbol={selectedMarketSymbol}
              timeframe={selectedAgent.timeframe}
              trace={selectedTrace}
              tradeIdea={selectedTradeIdea}
              position={selectedPosition}
              events={selectedEvents}
              marketNewsState={selectedMarket?.newsState}
              marketNewsUpdatedAt={selectedMarket?.newsUpdatedAt}
            />
          </article>

          <aside className="arena-detail-sidebar">
            <article className="arena-surface">
              <div className="arena-surface-header">
                <div className="arena-surface-title">
                  <Newspaper aria-hidden="true" size={18} />
                  <h2 className="font-barlow">News confluence</h2>
                </div>
              </div>
              {selectedNewsRationale ? (
                <div className="arena-news-rationale">
                  <span className="font-barlow">Why this confluence</span>
                  <p className="font-inter">{selectedNewsRationale}</p>
                </div>
              ) : null}
              <div className="arena-news-list">
                {selectedNewsContexts.length ? (
                  selectedNewsContexts.map((item) => (
                    <div key={item.id} className="arena-news-row">
                      <div className="arena-news-row-top">
                        <span className={`arena-pill is-${item.state} font-barlow`}>
                          {confluenceToneMap[item.state]}
                        </span>
                        {item.url ? (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="arena-news-link font-barlow"
                          >
                            Source
                            <ExternalLink aria-hidden="true" size={12} />
                          </a>
                        ) : null}
                      </div>
                      <strong className="font-barlow">{item.headline}</strong>
                      <span className="font-inter">
                        {item.marketSymbol} · {item.sourceLabel} · {item.publishedAt}
                      </span>
                      <p className="font-inter">{item.note}</p>
                    </div>
                  ))
                ) : (
                  <EmptyState
                    title="No current news confluence"
                    description="No mapped news context is attached to this market yet. The agent will rely on technical structure until a confluence signal is logged."
                  />
                )}
              </div>
            </article>

            <article className="arena-surface">
              <div className="arena-surface-header">
                <div className="arena-surface-title">
                  <Radar aria-hidden="true" size={18} />
                  <h2 className="font-barlow">Watchlist state</h2>
                </div>
              </div>
              <div className="arena-watchlist">
                {selectedWatchlist.length ? (
                  selectedWatchlist.map((item) => (
                    <div key={item.id} className="arena-watch-row">
                      <strong className="font-barlow">{item.setupLabel}</strong>
                      <span className="font-inter">
                        {item.marketSymbol} · {item.timeframe} · {item.status}
                      </span>
                      <p className="font-inter">{item.triggerNote}</p>
                    </div>
                  ))
                ) : (
                  <EmptyState
                    title="Nothing on watch here yet"
                    description="This market is in the agent's orbit, but there is no active watchlist state recorded for the current timeframe."
                  />
                )}
              </div>
            </article>

            <article className="arena-surface">
              <div className="arena-surface-header">
                <div className="arena-surface-title">
                  <Activity aria-hidden="true" size={18} />
                  <h2 className="font-barlow">Agent event log</h2>
                </div>
              </div>
              <div className="arena-event-list is-detailed">
                {selectedEvents.length ? (
                  selectedEvents.map((event) => (
                    <div key={event.id} className="arena-event-row">
                      <span className="arena-event-time font-barlow">
                        {event.timestamp}
                      </span>
                      <div>
                        <strong className="font-barlow">{event.title}</strong>
                        <span className="font-inter">{event.detail}</span>
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
            </article>
          </aside>
        </section>
      </section>
    </main>
  );
}
