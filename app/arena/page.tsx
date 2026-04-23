import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  Eye,
  LineChart,
  Newspaper,
  Radar,
  Trophy,
} from "lucide-react";
import TradingViewWorkspace from "@/components/tradingview-workspace";
import {
  agents,
  markets,
  newsContexts,
  positions,
  tradeEvents,
  tradeIdeas,
  visualTraces,
  watchlistItems,
} from "@/lib/arena-mock-data";

type ArenaPageProps = {
  searchParams?: Promise<{
    agent?: string;
  }>;
};

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

export default async function ArenaPage({ searchParams }: ArenaPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const selectedAgent =
    agents.find((agent) => agent.id === resolvedSearchParams.agent) ?? agents[0];

  const selectedTradeIdea = tradeIdeas.find(
    (idea) => idea.agentId === selectedAgent.id,
  );
  const selectedTrace = visualTraces.find(
    (trace) => trace.agentId === selectedAgent.id,
  );
  const selectedEvents = tradeEvents.filter(
    (event) => event.agentId === selectedAgent.id,
  );
  const selectedWatchlist = watchlistItems.filter(
    (item) => item.agentId === selectedAgent.id,
  );
  const selectedPosition = positions.find(
    (position) => position.agentId === selectedAgent.id,
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
              Mock trading state for the first two strategy agents.
            </h1>
            <p className="arena-dashboard-intro font-inter">
              This route locks the initial implementation surface: typed entities,
              mock backend state, leaderboard context, watchlists, positions,
              recent decisions, and a selected agent detail panel.
            </p>
          </div>

          <div className="arena-status-strip">
            <div className="arena-status-card">
              <span className="font-barlow">Season</span>
              <strong className="font-instrument">S0 Mock</strong>
            </div>
            <div className="arena-status-card">
              <span className="font-barlow">Agents live</span>
              <strong className="font-instrument">{agents.length}</strong>
            </div>
            <div className="arena-status-card">
              <span className="font-barlow">Last sync</span>
              <strong className="font-instrument">2m ago</strong>
            </div>
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
              <span className="arena-chip font-barlow">{markets.length} markets</span>
            </div>
            <div className="arena-market-list">
              {markets.map((market) => (
                <div key={market.symbol} className="arena-market-row">
                  <div>
                    <strong className="font-barlow">{market.symbol}</strong>
                    <span className="font-inter">{market.displayName}</span>
                  </div>
                  <div>
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
                </div>
              ))}
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
                    <strong className="font-barlow is-positive">
                      +{position.pnlPercent.toFixed(2)}%
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
              {tradeEvents.slice(0, 4).map((event) => (
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
                  {selectedAgent.primaryMarket}
                </span>
                <span className="arena-chip font-barlow">
                  {statusLabelMap[selectedAgent.status]}
                </span>
                <span className="arena-chip font-barlow">
                  {selectedAgent.timeframe}
                </span>
              </div>
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
            ) : null}

            <TradingViewWorkspace
              marketSymbol={selectedAgent.primaryMarket}
              timeframe={selectedAgent.timeframe}
              trace={selectedTrace}
              tradeIdea={selectedTradeIdea}
              position={selectedPosition}
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
              <div className="arena-news-list">
                {newsContexts.map((item) => (
                  <div key={item.id} className="arena-news-row">
                    <span className={`arena-pill is-${item.state} font-barlow`}>
                      {confluenceToneMap[item.state]}
                    </span>
                    <strong className="font-barlow">{item.headline}</strong>
                    <span className="font-inter">
                      {item.marketSymbol} · {item.sourceLabel} · {item.publishedAt}
                    </span>
                    <p className="font-inter">{item.note}</p>
                  </div>
                ))}
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
                {selectedWatchlist.map((item) => (
                  <div key={item.id} className="arena-watch-row">
                    <strong className="font-barlow">{item.setupLabel}</strong>
                    <span className="font-inter">
                      {item.marketSymbol} · {item.timeframe} · {item.status}
                    </span>
                    <p className="font-inter">{item.triggerNote}</p>
                  </div>
                ))}
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
                {selectedEvents.map((event) => (
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
          </aside>
        </section>
      </section>
    </main>
  );
}
