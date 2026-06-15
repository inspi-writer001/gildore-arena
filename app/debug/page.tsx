"use client";

import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { ChartVisionDecision } from "@/lib/chart-vision-analysis";
import { BrowserSessionViewport } from "@/components/arena/browser-session-viewport";

const AGENTS = [
  { slug: "third-touch", name: "Kairos — Third Touch", timeframe: "1h", note: "1h → 15m" },
  { slug: "fibonacci-trend", name: "Auron — Fibonacci Trend", timeframe: "15m", note: "8h → 4h" },
];

const MARKETS = [
  "XAU/USD",
  "XAG/USD",
  "EUR/USD",
  "GBP/USD",
  "USD/JPY",
  "Volatility 15 (1s) Index",
  "Volatility 10 Index",
  "Volatility 25 Index",
  "Volatility 75 Index",
];

function verdictColor(v: string) {
  if (v === "valid") return "text-emerald-400";
  if (v === "staged") return "text-amber-400";
  if (v === "invalid") return "text-orange-400";
  return "text-red-400";
}

function structureColor(sv: string) {
  if (sv === "drawable") return "text-emerald-400";
  if (sv === "watch_future_touch") return "text-amber-400";
  if (sv === "broken") return "text-red-400";
  return "text-zinc-500";
}

function useElapsed(running: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (running) {
      setElapsed(0);
      ref.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } else {
      if (ref.current) clearInterval(ref.current);
    }
    return () => { if (ref.current) clearInterval(ref.current); };
  }, [running]);

  return elapsed;
}

export default function DebugPage() {
  const [agentSlug, setAgentSlug] = useState("third-touch");
  const [marketSymbol, setMarketSymbol] = useState("Volatility 15 (1s) Index");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [decision, setDecision] = useState<ChartVisionDecision | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [entryPosting, setEntryPosting] = useState(false);
  const [entryDone, setEntryDone] = useState(false);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [capturedViews, setCapturedViews] = useState<string[]>([]);
  const [expandedView, setExpandedView] = useState<number | null>(null);
  const elapsed = useElapsed(running);

  const agent = AGENTS.find((a) => a.slug === agentSlug) ?? AGENTS[0];

  async function handleRun() {
    setRunning(true);
    setError(null);
    setSessionId(null);
    setDecision(null);
    setDurationMs(null);
    setEntryDone(false);
    setEntryError(null);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300_000);

    try {
      const res = await fetch("/api/debug/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentSlug,
          marketSymbol,
          timeframe: agent.timeframe,
        }),
        signal: controller.signal,
      });
      const data = (await res.json()) as { ok: boolean; error?: string; sessionId?: string; durationMs?: number; capturedViews?: string[] };
      if (!data.ok || !data.sessionId) {
        setError(data.error ?? "session_start_failed");
      } else {
        setSessionId(data.sessionId);
        setDurationMs(data.durationMs ?? null);
        setCapturedViews(data.capturedViews ?? []);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setError("Timed out after 5 minutes — check server terminal.");
      } else {
        setError(err instanceof Error ? err.message : "network_error");
      }
    } finally {
      clearTimeout(timeout);
      setRunning(false);
    }
  }

  async function handlePointEntry() {
    if (!sessionId) return;
    setEntryPosting(true);
    setEntryError(null);
    try {
      const res = await fetch("/api/debug/session/point-entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        setEntryError(data.error ?? "draw_failed");
      } else {
        setEntryDone(true);
      }
    } catch (err) {
      setEntryError(err instanceof Error ? err.message : "network_error");
    } finally {
      setEntryPosting(false);
    }
  }

  const d = decision;
  const hasEntryZone = !!d?.correctedZone && (d?.direction === "long" || d?.direction === "short");

  return (
    <div className="min-h-screen bg-[#0c0c0c] text-[#e8e8e2] font-mono p-6">
      <div className="max-w-[1600px] mx-auto">
        <div className="mb-6">
          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 mb-1">Vision debug</p>
          <h1 className="text-2xl font-semibold text-white">Live Capture</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Spins up a live browser session you can watch. Analysis runs automatically. No Convex writes.
          </p>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap gap-3 mb-6 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Agent</label>
            <select
              value={agentSlug}
              onChange={(e) => setAgentSlug(e.target.value)}
              disabled={running || !!sessionId}
              className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500 disabled:opacity-40"
            >
              {AGENTS.map((a) => (
                <option key={a.slug} value={a.slug}>{a.name}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Market</label>
            <select
              value={marketSymbol}
              onChange={(e) => setMarketSymbol(e.target.value)}
              disabled={running || !!sessionId}
              className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500 disabled:opacity-40"
            >
              {MARKETS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Flow</label>
            <div className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-400">
              {agent.note}
            </div>
          </div>

          <button
            type="button"
            onClick={handleRun}
            disabled={running || !!sessionId}
            className={cn(
              "px-5 py-2 rounded-lg text-sm font-semibold transition-all",
              running || sessionId
                ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                : "bg-white text-black hover:bg-zinc-200 active:scale-[0.98]",
            )}
          >
            {running ? "Starting…" : sessionId ? "Session Active" : "Launch & Analyze"}
          </button>

          {running && (
            <span className="text-sm text-zinc-400 self-end pb-2 tabular-nums">
              {elapsed}s
            </span>
          )}

          {durationMs !== null && !running && (
            <span className="text-xs text-zinc-500 self-end pb-2">
              analysis completed in {(durationMs / 1000).toFixed(1)}s
            </span>
          )}

          {sessionId && !running && (
            <button
              type="button"
              onClick={() => {
                setSessionId(null);
                setDecision(null);
                setDurationMs(null);
                setCapturedViews([]);
                setExpandedView(null);
                setEntryDone(false);
                setEntryError(null);
              }}
              className="px-3 py-2 rounded-lg text-xs text-zinc-500 border border-zinc-800 hover:border-zinc-600 hover:text-zinc-300 transition-colors self-end"
            >
              New session
            </button>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-950/40 border border-red-800/60 rounded-xl p-4 mb-6 text-sm text-red-400">
            <p className="font-semibold mb-1">Error</p>
            <p>{error}</p>
          </div>
        )}

        {/* Captured views strip */}
        {capturedViews.length > 0 && (
          <div className="mb-6">
            <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500 mb-3">
              Screenshots fed to vision ({capturedViews.length} views)
            </p>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {capturedViews.map((src, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setExpandedView(expandedView === i ? null : i)}
                  className="flex-shrink-0 flex flex-col gap-1.5 group"
                >
                  <div className={cn(
                    "rounded-lg overflow-hidden border transition-colors",
                    expandedView === i ? "border-amber-500" : "border-zinc-800 group-hover:border-zinc-600",
                  )}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`View ${i + 1}`} className="w-[280px] h-auto block" />
                  </div>
                  <span className="text-[10px] text-zinc-500 text-center">View {i + 1}/{capturedViews.length}</span>
                </button>
              ))}
            </div>
            {expandedView !== null && (
              <div className="mt-4 rounded-xl overflow-hidden border border-amber-500/40">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={capturedViews[expandedView]}
                  alt={`View ${expandedView + 1} expanded`}
                  className="w-full block"
                />
              </div>
            )}
          </div>
        )}

        {/* Main layout: browser viewport left, decision panel right */}
        {(running || sessionId) && (
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6">
            {/* Browser stream */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                  Live browser
                </p>
                {sessionId && hasEntryZone && (
                  <div className="flex items-center gap-3">
                    {entryError && (
                      <span className="text-xs text-red-400">{entryError}</span>
                    )}
                    <button
                      type="button"
                      onClick={handlePointEntry}
                      disabled={entryPosting || entryDone}
                      className={cn(
                        "px-4 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2",
                        entryDone
                          ? "bg-emerald-900/40 text-emerald-400 border border-emerald-800/60 cursor-default"
                          : entryPosting
                          ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                          : d?.direction === "long"
                          ? "bg-emerald-600 hover:bg-emerald-500 text-white active:scale-[0.98]"
                          : "bg-red-600 hover:bg-red-500 text-white active:scale-[0.98]",
                      )}
                    >
                      {entryDone ? (
                        <>{d?.direction === "long" ? "Long Opened ✓" : "Short Opened ✓"}</>
                      ) : entryPosting ? (
                        <>Opening…</>
                      ) : (
                        <>{d?.direction === "long" ? "Open Long" : "Open Short"}</>
                      )}
                    </button>
                  </div>
                )}
              </div>

              <div className="rounded-xl overflow-hidden border border-zinc-800 bg-black">
                {running && !sessionId ? (
                  <div className="aspect-[1440/900] flex items-center justify-center">
                    <div className="text-center">
                      <div className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse mx-auto mb-3" />
                      <p className="text-sm text-zinc-400">
                        {elapsed < 20 && "Launching browser…"}
                        {elapsed >= 20 && elapsed < 50 && "Navigating to chart…"}
                        {elapsed >= 50 && elapsed < 90 && "Switching symbol and timeframe…"}
                        {elapsed >= 90 && elapsed < 150 && "Capturing screenshots…"}
                        {elapsed >= 150 && "Running vision analysis…"}
                      </p>
                      <p className="text-xs text-zinc-600 mt-1">{elapsed}s</p>
                    </div>
                  </div>
                ) : sessionId ? (
                  <BrowserSessionViewport
                    sessionId={sessionId}
                    sessionStatus={running || entryPosting ? "running" : "ready"}
                    onDecision={(d) => setDecision(d)}
                  />
                ) : null}
              </div>
            </div>

            {/* Decision panel */}
            <div className="flex flex-col gap-4">
              <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                Vision Decision
              </p>

              {!decision && sessionId && (
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-sm text-zinc-600">
                  Waiting for analysis to complete…
                </div>
              )}

              {d && (
                <>
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col gap-2.5 text-sm">
                    <Row label="verdict" value={d.verdict} className={verdictColor(d.verdict)} bold />
                    <Row label="structureVerdict" value={d.structureVerdict} className={structureColor(d.structureVerdict)} bold />
                    <Row label="regime" value={d.regime} />
                    <Row
                      label="direction"
                      value={d.direction}
                      className={d.direction === "long" ? "text-emerald-400" : d.direction === "short" ? "text-red-400" : "text-zinc-400"}
                      bold
                    />
                    <Row label="confidence" value={`${Math.round(d.confidence * 100)}%`} />
                    {d.nextState && <Row label="nextState" value={d.nextState} className="text-amber-400" />}
                    {d.confirmationStatus && <Row label="confirmationStatus" value={d.confirmationStatus} />}
                  </div>

                  {(d.correctedT1 || d.correctedT2 || d.correctedZone || d.invalidationZone) && (
                    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col gap-3 text-sm">
                      {d.correctedT1 && (
                        <div>
                          <span className="text-zinc-500">T1 </span>
                          <span className="text-white font-semibold">{d.correctedT1.price}</span>
                          {d.correctedT1.date && <span className="text-zinc-600 ml-2 text-xs">{d.correctedT1.date}</span>}
                          <p className="text-zinc-400 text-xs mt-0.5">{d.correctedT1.note}</p>
                        </div>
                      )}
                      {d.correctedT2 && (
                        <div>
                          <span className="text-zinc-500">T2 </span>
                          <span className="text-white font-semibold">{d.correctedT2.price}</span>
                          {d.correctedT2.date && <span className="text-zinc-600 ml-2 text-xs">{d.correctedT2.date}</span>}
                          <p className="text-zinc-400 text-xs mt-0.5">{d.correctedT2.note}</p>
                        </div>
                      )}
                      {d.correctedZone && (
                        <div>
                          <span className="text-zinc-500">zone </span>
                          <span className="text-white">{d.correctedZone.low} – {d.correctedZone.high}</span>
                          {d.correctedZone.projectedPrice && (
                            <span className="text-zinc-600 ml-2 text-xs">proj {d.correctedZone.projectedPrice}</span>
                          )}
                        </div>
                      )}
                      {d.invalidationZone && (
                        <div>
                          <span className="text-zinc-500">invalidation </span>
                          <span className="text-red-400">{d.invalidationZone.low} – {d.invalidationZone.high}</span>
                          {d.invalidationNote && <p className="text-red-400/60 text-xs mt-0.5">{d.invalidationNote}</p>}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-sm">
                    <p className="text-zinc-500 mb-2 text-[10px] uppercase tracking-[0.14em]">Rationale</p>
                    <p className="text-zinc-300 leading-relaxed text-xs">{d.rationale}</p>
                    {d.issues.length > 0 && (
                      <ul className="mt-3 flex flex-col gap-1">
                        {d.issues.map((issue, i) => (
                          <li key={i} className="text-zinc-500 text-xs flex gap-1.5">
                            <span className="text-zinc-700">—</span>{issue}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <details className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                    <summary className="px-4 py-3 text-[10px] uppercase tracking-[0.14em] text-zinc-500 cursor-pointer hover:text-zinc-300 transition-colors select-none">
                      Raw JSON
                    </summary>
                    <pre className="px-4 pb-4 text-[10px] text-zinc-400 overflow-x-auto leading-relaxed">
                      {JSON.stringify(d, null, 2)}
                    </pre>
                  </details>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  className,
  bold,
}: {
  label: string;
  value: string;
  className?: string;
  bold?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-zinc-500 shrink-0">{label}</span>
      <span className={cn(bold && "font-semibold", className ?? "text-white")}>{value}</span>
    </div>
  );
}
