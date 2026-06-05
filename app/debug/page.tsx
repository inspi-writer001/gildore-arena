"use client";

import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { ChartVisionDecision } from "@/lib/chart-vision-analysis";

type DebugResult = {
  screenshots: string[];
  decision: ChartVisionDecision;
  durationMs: number;
};

const AGENTS = [
  { slug: "third-touch", name: "Kairos — Third Touch", timeframe: "1h", note: "4h → 1h → 15m" },
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
  const [result, setResult] = useState<DebugResult | null>(null);
  const [enlarged, setEnlarged] = useState<string | null>(null);
  const elapsed = useElapsed(running);

  const agent = AGENTS.find((a) => a.slug === agentSlug) ?? AGENTS[0];

  async function handleRun() {
    setRunning(true);
    setError(null);
    setResult(null);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300_000);

    try {
      const res = await fetch("/api/debug/screenshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentSlug,
          marketSymbol,
          timeframe: agent.timeframe,
        }),
        signal: controller.signal,
      });
      const data = (await res.json()) as { ok: boolean; error?: string } & Partial<DebugResult>;
      if (!data.ok || !data.screenshots || !data.decision) {
        setError(data.error ?? "capture_failed");
      } else {
        setResult({ screenshots: data.screenshots, decision: data.decision, durationMs: data.durationMs ?? 0 });
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setError("Timed out after 5 minutes — check server terminal for where it hung.");
      } else {
        setError(err instanceof Error ? err.message : "network_error");
      }
    } finally {
      clearTimeout(timeout);
      setRunning(false);
    }
  }

  const d = result?.decision;

  return (
    <div className="min-h-screen bg-[#0c0c0c] text-[#e8e8e2] font-mono p-6">
      <div className="max-w-[1400px] mx-auto">
        <div className="mb-8">
          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 mb-1">Vision debug</p>
          <h1 className="text-2xl font-semibold text-white">Screenshot Capture</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Triggers a live browser session and vision analysis. No Convex writes. Check server terminal for logs.
          </p>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap gap-3 mb-8 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Agent</label>
            <select
              value={agentSlug}
              onChange={(e) => setAgentSlug(e.target.value)}
              disabled={running}
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
              disabled={running}
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
            disabled={running}
            className={cn(
              "px-5 py-2 rounded-lg text-sm font-semibold transition-all",
              running
                ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                : "bg-white text-black hover:bg-zinc-200 active:scale-[0.98]",
            )}
          >
            {running ? "Running…" : "Capture & Analyze"}
          </button>

          {running && (
            <span className="text-sm text-zinc-400 self-end pb-2 tabular-nums">
              {elapsed}s
            </span>
          )}

          {result && !running && (
            <span className="text-xs text-zinc-500 self-end pb-2">
              completed in {(result.durationMs / 1000).toFixed(1)}s
            </span>
          )}
        </div>

        {/* Running state */}
        {running && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-6 text-sm text-zinc-400">
            <div className="flex items-start gap-3">
              <div className="mt-1 w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
              <div>
                <p>
                  Launching browser → switching to <span className="text-white">{marketSymbol}</span> →
                  capturing <span className="text-white">6 screenshots</span> ({agent.note}) → running vision analysis
                </p>
                <p className="text-zinc-600 mt-1 text-xs">
                  {elapsed < 30 && "Starting browser and navigating to Deriv…"}
                  {elapsed >= 30 && elapsed < 60 && "Switching symbol and timeframe…"}
                  {elapsed >= 60 && elapsed < 120 && "Capturing screenshots across timeframes…"}
                  {elapsed >= 120 && "Running Claude vision analysis…"}
                </p>
                <p className="text-zinc-600 mt-1 text-xs">
                  Check the server terminal for detailed logs if this takes more than 3 minutes.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-950/40 border border-red-800/60 rounded-xl p-4 mb-6 text-sm text-red-400">
            <p className="font-semibold mb-1">Error</p>
            <p>{error}</p>
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6">
            {/* Screenshots */}
            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500 mb-3">
                {result.screenshots.length} screenshots — click to enlarge
              </p>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                {result.screenshots.map((src, i) => {
                  const viewLabels = agentSlug === "third-touch"
                    ? ["4h — regime", "1h — full slope", "1h — reaction", "15m — context", "15m — execution", "15m — canvas"]
                    : ["8h — cycle", "8h — T1 origin", "4h — zoom out", "4h — T1 centred", "4h — slope", "4h — canvas"];
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setEnlarged(src)}
                      className="relative rounded-lg overflow-hidden border border-zinc-800 hover:border-zinc-600 transition-colors cursor-zoom-in group"
                    >
                      <div className="absolute top-1.5 left-1.5 z-10 flex gap-1">
                        <span className="bg-black/80 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                          {i + 1}
                        </span>
                        <span className="bg-black/60 text-zinc-300 text-[10px] px-1.5 py-0.5 rounded hidden group-hover:block">
                          {viewLabels[i]}
                        </span>
                      </div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt={`View ${i + 1}`} className="w-full h-auto block" />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Decision panel */}
            {d && (
              <div className="flex flex-col gap-4">
                <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Vision Decision</p>

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
                        <span className="text-zinc-600 ml-2 text-xs">proj {d.correctedZone.projectedPrice}</span>
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
              </div>
            )}
          </div>
        )}
      </div>

      {enlarged && (
        <button
          type="button"
          className="fixed inset-0 bg-black/92 z-50 flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setEnlarged(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={enlarged}
            alt="Enlarged"
            className="max-w-full max-h-full rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </button>
      )}
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
