"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CandlestickChart,
  Eye,
  Layers3,
  Pause,
  Play,
  Route,
  Sparkles,
} from "lucide-react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type {
  Position,
  TradeEvent,
  TradeIdea,
  VisualAnnotation,
  VisualGeometry,
  VisualTrace,
} from "@/lib/arena-types";

type TradingViewWorkspaceProps = {
  marketSymbol: string;
  timeframe: "15m" | "1h" | "4h";
  trace: VisualTrace | undefined;
  tradeIdea: TradeIdea | undefined;
  position: Position | undefined;
  events: TradeEvent[];
};

type CandlePoint = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
};

type PythHistoryResponse = {
  candles: CandlePoint[];
};

const timeframeMinutesMap: Record<TradingViewWorkspaceProps["timeframe"], number> = {
  "15m": 15,
  "1h": 60,
  "4h": 240,
};

function buildMockCandles(
  anchorPrice: number,
  timeframe: TradingViewWorkspaceProps["timeframe"],
): CandlePoint[] {
  const candles: CandlePoint[] = [];
  const stepSeconds = timeframeMinutesMap[timeframe] * 60;
  const now = Math.floor(Date.now() / 1000);
  const start = now - stepSeconds * 80;
  let lastClose = anchorPrice * 0.985;

  for (let index = 0; index < 80; index += 1) {
    const drift = Math.sin(index / 7) * anchorPrice * 0.0018;
    const impulse = Math.cos(index / 5) * anchorPrice * 0.0009;
    const open = lastClose;
    const close = open + drift + impulse;
    const high = Math.max(open, close) + anchorPrice * (0.001 + (index % 4) * 0.0003);
    const low = Math.min(open, close) - anchorPrice * (0.001 + ((index + 2) % 4) * 0.00028);

    candles.push({
      time: (start + index * stepSeconds) as UTCTimestamp,
      open: Number(open.toFixed(4)),
      high: Number(high.toFixed(4)),
      low: Number(low.toFixed(4)),
      close: Number(close.toFixed(4)),
    });

    lastClose = close;
  }

  return candles;
}

export default function TradingViewWorkspace({
  marketSymbol,
  timeframe,
  trace,
  tradeIdea,
  position,
  events,
}: TradingViewWorkspaceProps) {
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  const anchorPrice = tradeIdea?.entry ?? position?.entry ?? 100;
  const entry = tradeIdea?.entry ?? position?.entry ?? anchorPrice;
  const stopLoss = tradeIdea?.stopLoss ?? position?.stopLoss ?? anchorPrice * 0.994;
  const takeProfit =
    tradeIdea?.takeProfit ?? position?.takeProfit ?? anchorPrice * 1.012;

  const [candles, setCandles] = useState<CandlePoint[]>(() =>
    buildMockCandles(anchorPrice, timeframe),
  );
  const [dataSourceLabel, setDataSourceLabel] = useState("Mock data");
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [liveDeltaPercent, setLiveDeltaPercent] = useState<number | null>(null);
  const annotationSummary = trace?.annotations ?? [];
  const replaySteps = Math.max(
    1,
    events.length,
    ...annotationSummary.map((annotation) => annotation.revealStep ?? 1),
  );
  const [visibleLayers, setVisibleLayers] = useState({
    trendline: true,
    fibonacci: true,
    zone: true,
    levels: true,
  });
  const [replayStep, setReplayStep] = useState(replaySteps);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    setCandles(buildMockCandles(anchorPrice, timeframe));
    setDataSourceLabel("Mock data");
    setLivePrice(null);
    setLiveDeltaPercent(null);
  }, [anchorPrice, timeframe]);

  useEffect(() => {
    const resolutionMap = {
      "15m": "15",
      "1h": "60",
      "4h": "240",
    } as const;

    const now = Math.floor(Date.now() / 1000);
    const lookbackSecondsMap = {
      "15m": 15 * 60 * 80,
      "1h": 60 * 60 * 80,
      "4h": 4 * 60 * 60 * 80,
    } as const;

    let disposed = false;

    async function loadPythCandles() {
      try {
        const params = new URLSearchParams({
          symbol: marketSymbol,
          resolution: resolutionMap[timeframe],
          from: String(now - lookbackSecondsMap[timeframe]),
          to: String(now),
        });

        const response = await fetch(`/api/pyth/history?${params.toString()}`);

        if (!response.ok) return;

        const payload = (await response.json()) as PythHistoryResponse;

        if (!payload.candles?.length) return;

        const normalizedCandles = payload.candles
          .filter(
            (candle) =>
              Number.isFinite(candle.time) &&
              Number.isFinite(candle.open) &&
              Number.isFinite(candle.high) &&
              Number.isFinite(candle.low) &&
              Number.isFinite(candle.close),
          )
          .map((candle) => ({
            time: candle.time,
            open: Number(candle.open),
            high: Number(candle.high),
            low: Number(candle.low),
            close: Number(candle.close),
          }));

        if (!normalizedCandles.length || disposed) return;

        const latestCandle = normalizedCandles[normalizedCandles.length - 1];
        const previousCandle =
          normalizedCandles[normalizedCandles.length - 2] ?? latestCandle;
        const deltaPercent =
          previousCandle.close !== 0
            ? ((latestCandle.close - previousCandle.close) / previousCandle.close) *
              100
            : 0;

        setCandles(normalizedCandles);
        setLivePrice(latestCandle.close);
        setLiveDeltaPercent(deltaPercent);
        setDataSourceLabel("Pyth live");
      } catch {
        // Keep mock fallback if Pyth is unavailable.
      }
    }

    void loadPythCandles();

    const intervalId = window.setInterval(() => {
      void loadPythCandles();
    }, 15000);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [marketSymbol, timeframe]);

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#f7f7f3" },
        textColor: "rgba(18, 18, 18, 0.72)",
        fontFamily: "Inter, sans-serif",
      },
      grid: {
        vertLines: { color: "rgba(18, 18, 18, 0.06)" },
        horzLines: { color: "rgba(18, 18, 18, 0.06)" },
      },
      rightPriceScale: {
        borderColor: "rgba(18, 18, 18, 0.08)",
      },
      timeScale: {
        borderColor: "rgba(18, 18, 18, 0.08)",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: "rgba(18, 18, 18, 0.12)" },
        horzLine: { color: "rgba(18, 18, 18, 0.12)" },
      },
      handleScroll: true,
      handleScale: true,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#111111",
      downColor: "#d7d7d1",
      borderUpColor: "#111111",
      borderDownColor: "#a8a8a3",
      wickUpColor: "#111111",
      wickDownColor: "#8c8c88",
      priceLineVisible: false,
      lastValueVisible: false,
    });

    series.setData(candles);
    chart.timeScale().fitContent();

    if (visibleLayers.levels) {
      series.createPriceLine({
        price: entry,
        color: "#111111",
        lineWidth: 2,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "Entry",
      });

      series.createPriceLine({
        price: stopLoss,
        color: "#a33030",
        lineWidth: 1,
        lineStyle: 0,
        axisLabelVisible: true,
        title: "SL",
      });

      series.createPriceLine({
        price: takeProfit,
        color: "#1a7f46",
        lineWidth: 1,
        lineStyle: 0,
        axisLabelVisible: true,
        title: "TP",
      });
    }

    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [candles, entry, stopLoss, takeProfit, visibleLayers.levels]);

  useEffect(() => {
    setReplayStep(replaySteps);
    setIsPlaying(false);
  }, [replaySteps, trace?.id, marketSymbol, timeframe]);

  useEffect(() => {
    if (!isPlaying) return;

    const intervalId = window.setInterval(() => {
      setReplayStep((currentStep) => {
        if (currentStep >= replaySteps) {
          window.clearInterval(intervalId);
          setIsPlaying(false);
          return replaySteps;
        }

        return currentStep + 1;
      });
    }, 1200);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isPlaying, replaySteps]);

  const priceRange = useMemo(() => {
    const lows = candles.map((candle) => candle.low);
    const highs = candles.map((candle) => candle.high);

    return {
      min: Math.min(...lows, stopLoss),
      max: Math.max(...highs, takeProfit),
    };
  }, [candles, stopLoss, takeProfit]);

  const overlayAnnotations = annotationSummary.filter((annotation) => {
    if ((annotation.revealStep ?? 1) > replayStep || !annotation.geometry) {
      return false;
    }

    if (annotation.type === "trendline") return visibleLayers.trendline;
    if (annotation.type === "fibonacci") return visibleLayers.fibonacci;
    if (annotation.type === "zone") return visibleLayers.zone;
    if (
      annotation.type === "entry" ||
      annotation.type === "stop-loss" ||
      annotation.type === "take-profit"
    ) {
      return visibleLayers.levels;
    }

    return true;
  });
  const activeEvent = events[Math.max(0, Math.min(replayStep - 1, events.length - 1))];

  const toggleLayer = (layer: keyof typeof visibleLayers) => {
    setVisibleLayers((current) => ({
      ...current,
      [layer]: !current[layer],
    }));
  };

  return (
    <section className="arena-workspace-card">
      <div className="arena-surface-header">
        <div className="arena-surface-title">
          <CandlestickChart aria-hidden="true" size={18} />
          <h3 className="font-barlow">Chart workspace</h3>
        </div>
        <div className="arena-workspace-meta">
          <span className="arena-chip font-barlow">{marketSymbol}</span>
          <span className="arena-chip font-barlow">{timeframe}</span>
          <span className="arena-chip font-barlow">{dataSourceLabel}</span>
          {livePrice !== null ? (
            <span className="arena-chip font-barlow">
              {livePrice.toFixed(marketSymbol === "EUR/USD" ? 4 : 2)}
              {liveDeltaPercent !== null ? (
                <span
                  className={`arena-chip-move ${liveDeltaPercent >= 0 ? "is-positive" : "is-negative"}`}
                >
                  {liveDeltaPercent >= 0 ? "+" : ""}
                  {liveDeltaPercent.toFixed(2)}%
                </span>
              ) : null}
            </span>
          ) : null}
          {trace ? (
            <span className="arena-chip font-barlow">{trace.updatedAt}</span>
          ) : null}
        </div>
      </div>

      <div className="arena-workspace-toolbar" aria-label="Workspace layers">
        <button className="arena-tool-chip font-barlow is-static" type="button">
          <Layers3 aria-hidden="true" size={14} />
          Agent layers
        </button>
        <button
          className={`arena-tool-chip font-barlow${visibleLayers.trendline ? " is-active" : ""}`}
          type="button"
          onClick={() => toggleLayer("trendline")}
          aria-pressed={visibleLayers.trendline}
        >
          <Route aria-hidden="true" size={14} />
          Trendline
        </button>
        <button
          className={`arena-tool-chip font-barlow${visibleLayers.fibonacci ? " is-active" : ""}`}
          type="button"
          onClick={() => toggleLayer("fibonacci")}
          aria-pressed={visibleLayers.fibonacci}
        >
          <Sparkles aria-hidden="true" size={14} />
          Fibonacci
        </button>
        <button
          className={`arena-tool-chip font-barlow${visibleLayers.zone ? " is-active" : ""}`}
          type="button"
          onClick={() => toggleLayer("zone")}
          aria-pressed={visibleLayers.zone}
        >
          <Layers3 aria-hidden="true" size={14} />
          Zones
        </button>
        <button
          className={`arena-tool-chip font-barlow${visibleLayers.levels ? " is-active" : ""}`}
          type="button"
          onClick={() => toggleLayer("levels")}
          aria-pressed={visibleLayers.levels}
        >
          <Eye aria-hidden="true" size={14} />
          Levels
        </button>
      </div>

      <div className="arena-replay-bar">
        <div className="arena-replay-controls">
          <button
            className="arena-replay-button"
            type="button"
            onClick={() => {
              setIsPlaying(false);
              setReplayStep((currentStep) => Math.max(1, currentStep - 1));
            }}
            aria-label="Previous replay step"
          >
            <ChevronLeft aria-hidden="true" size={16} />
          </button>
          <button
            className="arena-replay-button is-primary"
            type="button"
            onClick={() => {
              if (replayStep >= replaySteps) {
                setReplayStep(1);
                setIsPlaying(true);
                return;
              }

              setIsPlaying((current) => !current);
            }}
            aria-label={isPlaying ? "Pause replay" : "Play replay"}
          >
            {isPlaying ? (
              <Pause aria-hidden="true" size={16} />
            ) : (
              <Play aria-hidden="true" size={16} />
            )}
            <span className="font-barlow">
              {isPlaying ? "Pause replay" : replayStep >= replaySteps ? "Restart replay" : "Play replay"}
            </span>
          </button>
          <button
            className="arena-replay-button"
            type="button"
            onClick={() => {
              setIsPlaying(false);
              setReplayStep((currentStep) => Math.min(replaySteps, currentStep + 1));
            }}
            aria-label="Next replay step"
          >
            <ChevronRight aria-hidden="true" size={16} />
          </button>
        </div>

        <div className="arena-replay-track">
          {events.map((event, index) => {
            const step = index + 1;
            const isVisible = step <= replayStep;
            const isActive = step === replayStep;

            return (
              <button
                key={event.id}
                className={`arena-replay-node${isVisible ? " is-visible" : ""}${isActive ? " is-active" : ""}`}
                type="button"
                onClick={() => {
                  setIsPlaying(false);
                  setReplayStep(step);
                }}
                aria-label={`Jump to ${event.title}`}
              >
                <span className="arena-replay-dot" />
                <span className="font-barlow">{event.timestamp}</span>
              </button>
            );
          })}
        </div>

        {activeEvent ? (
          <div className="arena-replay-summary">
            <strong className="font-barlow">{activeEvent.title}</strong>
            <span className="font-inter">{activeEvent.detail}</span>
          </div>
        ) : null}
      </div>

      <div className="arena-workspace-frame">
        <div ref={chartContainerRef} className="arena-tradingview-root" />

        <div className="arena-lightweight-overlay" aria-hidden="true">
          {overlayAnnotations.map((annotation) => (
            <OverlayAnnotation
              key={annotation.id}
              annotation={annotation}
              candleCount={candles.length}
              minPrice={priceRange.min}
              maxPrice={priceRange.max}
            />
          ))}
        </div>
      </div>

      <div className="arena-workspace-lower">
        <div className="arena-workspace-panel">
          <div className="arena-workspace-panel-title">
            <Sparkles aria-hidden="true" size={16} />
            <h4 className="font-barlow">Trace annotations</h4>
          </div>
          <div className="arena-annotation-list">
            {overlayAnnotations.map((annotation) => (
              <div key={annotation.id} className="arena-annotation-row">
                <strong className="font-barlow">{annotation.label}</strong>
                <span className="font-inter">{annotation.detail}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="arena-workspace-panel">
          <div className="arena-workspace-panel-title">
            <CandlestickChart aria-hidden="true" size={16} />
            <h4 className="font-barlow">Chart stack</h4>
          </div>
          <div className="arena-workspace-note-list">
            <div className="arena-watch-row">
              <strong className="font-barlow">Current layer</strong>
              <span className="font-inter">
                Lightweight Charts renders the actual candles and price levels.
              </span>
            </div>
            <div className="arena-watch-row">
              <strong className="font-barlow">Annotation model</strong>
              <span className="font-inter">
                Fibs, trendlines, zones, and markers now reveal by replay step from trace data.
              </span>
            </div>
            <div className="arena-watch-row">
              <strong className="font-barlow">Upgrade path</strong>
              <span className="font-inter">
                Swap to TradingView Advanced Charts later when the official files arrive.
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function xPercentFromBarIndex(barIndex: number, candleCount: number) {
  if (candleCount <= 1) return 50;
  const boundedIndex = Math.max(0, Math.min(candleCount - 1, barIndex));
  return (boundedIndex / (candleCount - 1)) * 100;
}

function yPercentFromPrice(price: number, minPrice: number, maxPrice: number) {
  if (maxPrice <= minPrice) return 50;
  const boundedPrice = Math.max(minPrice, Math.min(maxPrice, price));
  return ((maxPrice - boundedPrice) / (maxPrice - minPrice)) * 100;
}

function geometryTone(geometry: VisualGeometry) {
  if ("tone" in geometry) {
    return geometry.tone ?? "default";
  }

  return "default";
}

function OverlayAnnotation({
  annotation,
  candleCount,
  minPrice,
  maxPrice,
}: {
  annotation: VisualAnnotation;
  candleCount: number;
  minPrice: number;
  maxPrice: number;
}) {
  const geometry = annotation.geometry;

  if (!geometry) return null;

  if (geometry.kind === "line") {
    const left = xPercentFromBarIndex(geometry.start.barIndex, candleCount);
    const top = yPercentFromPrice(geometry.start.price, minPrice, maxPrice);
    const endLeft = xPercentFromBarIndex(geometry.end.barIndex, candleCount);
    const endTop = yPercentFromPrice(geometry.end.price, minPrice, maxPrice);
    const dx = endLeft - left;
    const dy = endTop - top;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

    return (
      <div
        className={`arena-overlay-line tone-${geometryTone(geometry)}`}
        style={{
          left: `${left}%`,
          top: `${top}%`,
          width: `${length}%`,
          transform: `rotate(${angle}deg)`,
        }}
      />
    );
  }

  if (geometry.kind === "fibonacci") {
    const left = xPercentFromBarIndex(geometry.startBarIndex, candleCount);
    const right = xPercentFromBarIndex(geometry.endBarIndex, candleCount);
    const top = yPercentFromPrice(geometry.highPrice, minPrice, maxPrice);
    const bottom = yPercentFromPrice(geometry.lowPrice, minPrice, maxPrice);

    return (
      <div
        className="arena-overlay-fib"
        style={{
          left: `${Math.min(left, right)}%`,
          top: `${Math.min(top, bottom)}%`,
          width: `${Math.abs(right - left)}%`,
          height: `${Math.abs(bottom - top)}%`,
        }}
      >
        {(geometry.levels ?? [0, 0.5, 0.618, 0.7, 1]).map((level) => (
          <div
            key={`${annotation.id}-${level}`}
            className="arena-overlay-fib-level"
            style={{ top: `${level * 100}%` }}
          />
        ))}
      </div>
    );
  }

  if (geometry.kind === "zone") {
    const left = xPercentFromBarIndex(geometry.startBarIndex, candleCount);
    const right = xPercentFromBarIndex(geometry.endBarIndex, candleCount);
    const top = yPercentFromPrice(geometry.highPrice, minPrice, maxPrice);
    const bottom = yPercentFromPrice(geometry.lowPrice, minPrice, maxPrice);

    return (
      <div
        className={`arena-overlay-zone tone-${geometryTone(geometry)}`}
        style={{
          left: `${Math.min(left, right)}%`,
          top: `${Math.min(top, bottom)}%`,
          width: `${Math.abs(right - left)}%`,
          height: `${Math.abs(bottom - top)}%`,
        }}
      />
    );
  }

  return (
    <div
      className={`arena-overlay-tag tone-${geometryTone(geometry)}`}
      style={{
        left: `${xPercentFromBarIndex(geometry.position.barIndex, candleCount)}%`,
        top: `${yPercentFromPrice(geometry.position.price, minPrice, maxPrice)}%`,
      }}
    >
      {geometry.text}
    </div>
  );
}
