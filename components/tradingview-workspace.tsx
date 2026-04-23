"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  CandlestickChart,
  Eye,
  Layers3,
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
import type { Position, TradeIdea, VisualTrace } from "@/lib/arena-types";

type TradingViewWorkspaceProps = {
  marketSymbol: string;
  timeframe: "15m" | "1h" | "4h";
  trace: VisualTrace | undefined;
  tradeIdea: TradeIdea | undefined;
  position: Position | undefined;
};

type CandlePoint = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
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
}: TradingViewWorkspaceProps) {
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  const anchorPrice = tradeIdea?.entry ?? position?.entry ?? 100;
  const entry = tradeIdea?.entry ?? position?.entry ?? anchorPrice;
  const stopLoss = tradeIdea?.stopLoss ?? position?.stopLoss ?? anchorPrice * 0.994;
  const takeProfit =
    tradeIdea?.takeProfit ?? position?.takeProfit ?? anchorPrice * 1.012;

  const candles = useMemo(
    () => buildMockCandles(anchorPrice, timeframe),
    [anchorPrice, timeframe],
  );

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

    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [candles, entry, stopLoss, takeProfit]);

  const annotationSummary = trace?.annotations ?? [];

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
          {trace ? (
            <span className="arena-chip font-barlow">{trace.updatedAt}</span>
          ) : null}
        </div>
      </div>

      <div className="arena-workspace-toolbar" aria-label="Workspace layers">
        <button className="arena-tool-chip font-barlow" type="button">
          <Layers3 aria-hidden="true" size={14} />
          Agent layers
        </button>
        <button className="arena-tool-chip font-barlow" type="button">
          <Route aria-hidden="true" size={14} />
          Trendline
        </button>
        <button className="arena-tool-chip font-barlow" type="button">
          <Sparkles aria-hidden="true" size={14} />
          Fibonacci
        </button>
        <button className="arena-tool-chip font-barlow" type="button">
          <Eye aria-hidden="true" size={14} />
          Replay
        </button>
      </div>

      <div className="arena-workspace-frame">
        <div ref={chartContainerRef} className="arena-tradingview-root" />

        <div className="arena-lightweight-overlay" aria-hidden="true">
          <div className="arena-overlay-line is-primary" />
          <div className="arena-overlay-line is-secondary" />
          <div className="arena-overlay-fib" />
          <div className="arena-overlay-zone" />
          <div className="arena-overlay-tag is-entry">Entry</div>
          <div className="arena-overlay-tag is-stop">SL</div>
          <div className="arena-overlay-tag is-target">TP</div>
        </div>
      </div>

      <div className="arena-workspace-lower">
        <div className="arena-workspace-panel">
          <div className="arena-workspace-panel-title">
            <Sparkles aria-hidden="true" size={16} />
            <h4 className="font-barlow">Trace annotations</h4>
          </div>
          <div className="arena-annotation-list">
            {annotationSummary.map((annotation) => (
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
                Fibs, trendlines, and zones stay in our own overlay system for now.
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
