"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  CandlestickChart,
  Eye,
  Layers3,
  Maximize2,
  Minimize2,
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
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type {
  ConfluenceState,
  Position,
  TradeEvent,
  TradeIdea,
  VisualAnnotation,
  VisualGeometry,
  VisualTrace,
} from "@/lib/arena-types";
import {
  getPythHistoryParams,
  getPythHistorySymbol,
  timeframeMinutesMap,
} from "@/lib/pyth-history";

type TradingViewWorkspaceProps = {
  marketSymbol: string;
  timeframe: "15m" | "1h" | "4h";
  trace: VisualTrace | undefined;
  tradeIdea: TradeIdea | undefined;
  position: Position | undefined;
  events: TradeEvent[];
  marketNewsState?: ConfluenceState;
  marketNewsUpdatedAt?: number | null;
  isWideLayout: boolean;
  onToggleLayout: () => void;
};

type CandlePoint = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
};

type OverlayFocusPoint = {
  barIndex: number;
  timeSec?: number;
  price: number;
  label: string;
  tone: "default" | "muted" | "entry" | "stop" | "target" | "zone";
};

type OverlayAreaFocus = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  label: string;
  tone: "default" | "muted" | "entry" | "stop" | "target" | "zone";
};

type CoordinateContext = {
  chart: IChartApi | null;
  series: ISeriesApi<"Candlestick"> | null;
};

function sameAnchor(
  left: {
    barIndex: number;
    timeSec?: number;
    price: number;
  },
  right: {
    barIndex: number;
    timeSec?: number;
    price: number;
  },
) {
  const sameTime =
    left.timeSec !== undefined && right.timeSec !== undefined
      ? left.timeSec === right.timeSec
      : left.barIndex === right.barIndex;

  return sameTime && Math.abs(left.price - right.price) < 0.0001;
}

const PYTH_HISTORY_BASE_URL = "https://history.pyth-lazer.dourolabs.app/v1";

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

function extractFocusPoints(annotation: VisualAnnotation): OverlayFocusPoint[] {
  const geometry = annotation.geometry;
  if (!geometry) return [];

  if (geometry.kind === "line") {
    const tone = geometry.tone ?? "default";
    return [
      {
        barIndex: geometry.start.barIndex,
        timeSec: geometry.start.timeSec,
        price: geometry.start.price,
        label: `${annotation.label} start`,
        tone,
      },
      {
        barIndex: geometry.end.barIndex,
        timeSec: geometry.end.timeSec,
        price: geometry.end.price,
        label: `${annotation.label} end`,
        tone,
      },
    ];
  }

  if (geometry.kind === "fibonacci") {
    return [
      {
        barIndex: geometry.startBarIndex,
        timeSec: geometry.startTimeSec,
        price: geometry.highPrice,
        label: `${annotation.label} high`,
        tone: "zone",
      },
      {
        barIndex: geometry.endBarIndex,
        timeSec: geometry.endTimeSec,
        price: geometry.lowPrice,
        label: `${annotation.label} low`,
        tone: "zone",
      },
    ];
  }

  if (geometry.kind === "zone") {
    const tone = geometry.tone ?? "zone";
    return [
      {
        barIndex: geometry.startBarIndex,
        timeSec: geometry.startTimeSec,
        price: geometry.highPrice,
        label: `${annotation.label} upper`,
        tone,
      },
      {
        barIndex: geometry.endBarIndex,
        timeSec: geometry.endTimeSec,
        price: geometry.lowPrice,
        label: `${annotation.label} lower`,
        tone,
      },
    ];
  }

  return [
    {
      barIndex: geometry.position.barIndex,
      timeSec: geometry.position.timeSec,
      price: geometry.position.price,
      label: geometry.text,
      tone: geometry.tone ?? "default",
    },
  ];
}

function extractAreaFocus(
  annotation: VisualAnnotation,
  coordinates: CoordinateContext,
): OverlayAreaFocus | null {
  const geometry = annotation.geometry;
  if (!geometry) return null;

  if (geometry.kind === "fibonacci") {
    const left = xCoordinateFromAnchor(
      {
        barIndex: geometry.startBarIndex,
        timeSec: geometry.startTimeSec,
      },
      coordinates,
    );
    const right = xCoordinateFromAnchor(
      {
        barIndex: geometry.endBarIndex,
        timeSec: geometry.endTimeSec,
      },
      coordinates,
    );
    const top = yCoordinateFromPrice(geometry.highPrice, coordinates);
    const bottom = yCoordinateFromPrice(geometry.lowPrice, coordinates);

    if (left === null || right === null || top === null || bottom === null) {
      return null;
    }

    return {
      left: Math.min(left, right),
      right: Math.max(left, right),
      top: Math.min(top, bottom),
      bottom: Math.max(top, bottom),
      label: annotation.label,
      tone: "zone",
    };
  }

  if (geometry.kind === "zone") {
    const left = xCoordinateFromAnchor(
      {
        barIndex: geometry.startBarIndex,
        timeSec: geometry.startTimeSec,
      },
      coordinates,
    );
    const right = xCoordinateFromAnchor(
      {
        barIndex: geometry.endBarIndex,
        timeSec: geometry.endTimeSec,
      },
      coordinates,
    );
    const top = yCoordinateFromPrice(geometry.highPrice, coordinates);
    const bottom = yCoordinateFromPrice(geometry.lowPrice, coordinates);

    if (left === null || right === null || top === null || bottom === null) {
      return null;
    }

    return {
      left: Math.min(left, right),
      right: Math.max(left, right),
      top: Math.min(top, bottom),
      bottom: Math.max(top, bottom),
      label: annotation.label,
      tone: geometry.tone ?? "zone",
    };
  }

  return null;
}

export default function TradingViewWorkspace({
  marketSymbol,
  timeframe,
  trace,
  tradeIdea,
  position,
  events,
  marketNewsState = "neutral",
  marketNewsUpdatedAt = null,
  isWideLayout,
  onToggleLayout,
}: TradingViewWorkspaceProps) {
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  const anchorPrice = tradeIdea?.entry ?? position?.entry ?? 100;
  const entry = tradeIdea?.entry ?? position?.entry ?? null;
  const stopLoss = tradeIdea?.stopLoss ?? position?.stopLoss ?? null;
  const takeProfit = tradeIdea?.takeProfit ?? position?.takeProfit ?? null;
  const hasTradeLevels =
    entry !== null && stopLoss !== null && takeProfit !== null;

  const [candles, setCandles] = useState<CandlePoint[]>(() =>
    buildMockCandles(anchorPrice, timeframe),
  );
  const [dataSourceLabel, setDataSourceLabel] = useState("Mock data");
  const [dataSourceTone, setDataSourceTone] = useState<
    "neutral" | "live" | "error"
  >("neutral");
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [liveDeltaPercent, setLiveDeltaPercent] = useState<number | null>(null);
  const [lastCandleTimestamp, setLastCandleTimestamp] = useState<number | null>(
    null,
  );
  const [lastFetchTimestamp, setLastFetchTimestamp] = useState<number | null>(
    null,
  );
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
  const [focusPulseKey, setFocusPulseKey] = useState(0);
  const [, setViewportVersion] = useState(0);
  const isReplayInspecting = isPlaying || replayStep !== replaySteps;

  useEffect(() => {
    setCandles(buildMockCandles(anchorPrice, timeframe));
    setDataSourceLabel("Mock data");
    setDataSourceTone("neutral");
    setLivePrice(null);
    setLiveDeltaPercent(null);
    setLastCandleTimestamp(null);
    setLastFetchTimestamp(null);
  }, [anchorPrice, timeframe]);

  useEffect(() => {
    let disposed = false;

    async function loadPythCandles() {
      try {
        if (!getPythHistorySymbol(marketSymbol)) {
          setDataSourceLabel("Pyth unavailable");
          setDataSourceTone("error");
          return;
        }

        const params = getPythHistoryParams(marketSymbol, timeframe);
        if (!params) {
          setDataSourceLabel("Pyth unavailable");
          setDataSourceTone("error");
          return;
        }

        const response = await fetch(
          `${PYTH_HISTORY_BASE_URL}/fixed_rate@200ms/history?${params.toString()}`,
        );

        if (!response.ok) {
          setDataSourceLabel("Pyth unavailable");
          setDataSourceTone("error");
          return;
        }

        const payload = (await response.json()) as {
          s?: string;
          t?: number[];
          o?: number[];
          h?: number[];
          l?: number[];
          c?: number[];
        };

        if (
          payload.s !== "ok" ||
          !payload.t ||
          !payload.o ||
          !payload.h ||
          !payload.l ||
          !payload.c
        ) {
          setDataSourceLabel("Pyth unavailable");
          setDataSourceTone("error");
          return;
        }

        const normalizedCandles = payload.t
          .map((time, index) => ({
            time: time as UTCTimestamp,
            open: payload.o?.[index],
            high: payload.h?.[index],
            low: payload.l?.[index],
            close: payload.c?.[index],
          }))
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

        if (!normalizedCandles.length || disposed) {
          if (!disposed) {
            setDataSourceLabel("Pyth unavailable");
            setDataSourceTone("error");
          }
          return;
        }

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
        setLastCandleTimestamp(latestCandle.time);
        setLastFetchTimestamp(Date.now());
        setDataSourceLabel("Pyth live");
        setDataSourceTone("live");
      } catch {
        if (!disposed) {
          setDataSourceLabel("Pyth unavailable");
          setDataSourceTone("error");
        }
      }
    }

    if (isReplayInspecting) {
      return () => {
        disposed = true;
      };
    }

    void loadPythCandles();

    const intervalId = window.setInterval(() => {
      void loadPythCandles();
    }, 15000);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [isReplayInspecting, marketSymbol, timeframe]);

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

    if (visibleLayers.levels && hasTradeLevels) {
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

    const syncOverlayViewport = () => {
      setViewportVersion((current) => current + 1);
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(syncOverlayViewport);
    chart.timeScale().subscribeVisibleTimeRangeChange(syncOverlayViewport);

    return () => {
      chart
        .timeScale()
        .unsubscribeVisibleLogicalRangeChange(syncOverlayViewport);
      chart.timeScale().unsubscribeVisibleTimeRangeChange(syncOverlayViewport);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [candles, entry, hasTradeLevels, stopLoss, takeProfit, visibleLayers.levels]);

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
      min: Math.min(...lows, stopLoss ?? Number.POSITIVE_INFINITY),
      max: Math.max(...highs, takeProfit ?? Number.NEGATIVE_INFINITY),
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
  const replayStepAnnotations = overlayAnnotations.filter(
    (annotation) => (annotation.revealStep ?? 1) === replayStep,
  );
  const replayFocusPoints = replayStepAnnotations.flatMap(extractFocusPoints);
  const coordinateContext = {
    chart: chartRef.current,
    series: seriesRef.current,
  } satisfies CoordinateContext;
  const activeEvent = events[Math.max(0, Math.min(replayStep - 1, events.length - 1))];
  const activeAreaAnnotation =
    activeEvent?.focusKind === "area"
      ? replayStepAnnotations.find((annotation) => {
          const geometry = annotation.geometry;
          return geometry?.kind === "fibonacci" || geometry?.kind === "zone";
        }) ??
        overlayAnnotations
          .slice()
          .reverse()
          .find((annotation) => {
            const geometry = annotation.geometry;
            return geometry?.kind === "fibonacci" || geometry?.kind === "zone";
          }) ??
        null
      : null;
  const activeAreaFocus =
    activeAreaAnnotation !== null
      ? extractAreaFocus(activeAreaAnnotation, coordinateContext)
      : null;
  const activeFocusPoint =
    activeAreaFocus === null
      ? replayFocusPoints[replayFocusPoints.length - 1] ??
        overlayAnnotations
          .slice()
          .reverse()
          .flatMap(extractFocusPoints)[0] ??
        null
      : null;
  const structuralMarkerAnchors = overlayAnnotations.flatMap((annotation) => {
    if (
      annotation.type !== "note" ||
      annotation.geometry?.kind !== "marker" ||
      !annotation.geometry.text.startsWith("T")
    ) {
      return [];
    }

    return [
      {
        barIndex: annotation.geometry.position.barIndex,
        timeSec: annotation.geometry.position.timeSec,
        price: annotation.geometry.position.price,
      },
    ];
  });
  const visibleReplayFocusPoints = replayFocusPoints.filter(
    (point) =>
      !structuralMarkerAnchors.some((anchor) => sameAnchor(point, anchor)),
  );
  const visibleActiveFocusPoint =
    activeFocusPoint &&
    structuralMarkerAnchors.some((anchor) => sameAnchor(activeFocusPoint, anchor))
      ? null
      : activeFocusPoint;

  useEffect(() => {
    if (!visibleActiveFocusPoint && !activeAreaFocus) return;
    setFocusPulseKey((current) => current + 1);
  }, [
    visibleActiveFocusPoint?.barIndex,
    visibleActiveFocusPoint?.price,
    visibleActiveFocusPoint?.label,
    activeAreaFocus?.left,
    activeAreaFocus?.right,
    activeAreaFocus?.top,
    activeAreaFocus?.bottom,
    activeAreaFocus?.label,
  ]);
  const dataAgeLabel =
    lastFetchTimestamp !== null
      ? `${Math.max(0, Math.floor((Date.now() - lastFetchTimestamp) / 1000))}s ago`
      : "Awaiting live fetch";
  const candleTimeLabel =
    lastCandleTimestamp !== null
      ? new Date(lastCandleTimestamp * 1000).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;
  const newsFreshnessLabel =
    marketNewsUpdatedAt !== null
      ? `${Math.max(
          1,
          Math.floor((Date.now() - marketNewsUpdatedAt) / 1000 / 60),
        )}m`
      : "stale";

  const toggleLayer = (layer: keyof typeof visibleLayers) => {
    setVisibleLayers((current) => ({
      ...current,
      [layer]: !current[layer],
    }));
  };

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || candles.length <= 1) return;

    const timeScale = chart.timeScale();
    const visibleRange = timeScale.getVisibleLogicalRange();
    const fallbackSpan = Math.min(Math.max(candles.length * 0.28, 36), candles.length);
    const span =
      visibleRange && Number.isFinite(visibleRange.from) && Number.isFinite(visibleRange.to)
        ? Math.max(visibleRange.to - visibleRange.from, 24)
        : fallbackSpan;

    let center = Math.floor(candles.length / 2);
    let targetFrom: number | null = null;
    let targetTo: number | null = null;

    const fitIndicesWithPadding = (indices: number[]) => {
      if (!indices.length) return false;
      const anchorStart = Math.min(...indices);
      const anchorEnd = Math.max(...indices);
      const padding = Math.max(6, Math.round((anchorEnd - anchorStart) * 0.12));

      targetFrom = Math.max(-2, anchorStart - padding);
      targetTo = Math.min(candles.length + 2, anchorEnd + padding);
      return true;
    };

    if (replayStepAnnotations.some((annotation) => annotation.type === "trendline")) {
      const structuralPoints = replayStepAnnotations.flatMap(extractFocusPoints);
      const structuralIndices = structuralPoints.map((point) =>
        resolveCandleIndex({
          barIndex: point.barIndex,
          timeSec: point.timeSec,
          candles,
        }),
      );

      if (fitIndicesWithPadding(structuralIndices)) {
        // Step 1 should fit the whole trendline structure, not center on one point.
      }
    }

    if (targetFrom === null && activeAreaAnnotation?.geometry) {
      const primaryTrendline = overlayAnnotations.find(
        (annotation) => annotation.type === "trendline",
      );
      const geometry = activeAreaAnnotation.geometry;
      if (geometry.kind === "fibonacci" || geometry.kind === "zone") {
        const startIndex = resolveCandleIndex({
          barIndex: geometry.startBarIndex,
          timeSec: geometry.startTimeSec,
          candles,
        });
        const endIndex = resolveCandleIndex({
          barIndex: geometry.endBarIndex,
          timeSec: geometry.endTimeSec,
          candles,
        });

        let anchorStart = Math.min(startIndex, endIndex);
        let anchorEnd = Math.max(startIndex, endIndex);

        if (
          primaryTrendline?.geometry &&
          primaryTrendline.geometry.kind === "line"
        ) {
          const trendStartIndex = resolveCandleIndex({
            barIndex: primaryTrendline.geometry.start.barIndex,
            timeSec: primaryTrendline.geometry.start.timeSec,
            candles,
          });
          const trendEndIndex = resolveCandleIndex({
            barIndex: primaryTrendline.geometry.end.barIndex,
            timeSec: primaryTrendline.geometry.end.timeSec,
            candles,
          });

          anchorStart = Math.min(anchorStart, trendStartIndex, trendEndIndex);
          anchorEnd = Math.max(anchorEnd, trendStartIndex, trendEndIndex);
        }

        fitIndicesWithPadding([anchorStart, anchorEnd]);
      }
    }

    if (activeFocusPoint && targetFrom === null) {
      center = resolveCandleIndex({
        barIndex: activeFocusPoint.barIndex,
        timeSec: activeFocusPoint.timeSec,
        candles,
      });
    } else if (activeAreaAnnotation?.geometry && targetFrom === null) {
      const geometry = activeAreaAnnotation.geometry;
      if (geometry.kind === "fibonacci" || geometry.kind === "zone") {
        const startIndex = resolveCandleIndex({
          barIndex: geometry.startBarIndex,
          timeSec: geometry.startTimeSec,
          candles,
        });
        const endIndex = resolveCandleIndex({
          barIndex: geometry.endBarIndex,
          timeSec: geometry.endTimeSec,
          candles,
        });
        center = Math.round((startIndex + endIndex) / 2);
      }
    } else {
      return;
    }

    if (targetFrom === null || targetTo === null) {
      targetFrom = Math.max(-2, center - span / 2);
      targetTo = Math.min(candles.length + 2, center + span / 2);
    }

    timeScale.setVisibleLogicalRange({
      from: targetFrom,
      to: targetTo,
    });
  }, [
    activeAreaAnnotation,
    activeFocusPoint,
    candles,
    overlayAnnotations,
    replayStep,
    replayStepAnnotations,
  ]);

  return (
    <section className="arena-workspace-card">
      <div className="arena-surface-header">
        <div className="arena-surface-title">
          <CandlestickChart aria-hidden="true" size={18} />
          <h3 className="font-barlow">Chart workspace</h3>
        </div>
        <div className="arena-workspace-meta">
          <button
            className="arena-tool-chip font-barlow"
            type="button"
            onClick={onToggleLayout}
            aria-label={isWideLayout ? "Reduce chart width" : "Expand chart width"}
          >
            {isWideLayout ? (
              <Minimize2 aria-hidden="true" size={14} />
            ) : (
              <Maximize2 aria-hidden="true" size={14} />
            )}
            {isWideLayout ? "Compact view" : "Full width"}
          </button>
          <span className="arena-chip font-barlow">{marketSymbol}</span>
          <span className="arena-chip font-barlow">{timeframe}</span>
          <span className={`arena-pill is-${marketNewsState} font-barlow`}>
            {marketNewsState}
          </span>
          <span className="arena-chip font-barlow">News {newsFreshnessLabel}</span>
          <span className={`arena-chip font-barlow tone-${dataSourceTone}`}>
            {dataSourceLabel}
          </span>
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

      <div className="arena-workspace-data-age">
        <span className="font-barlow">Feed status</span>
        <span className="font-inter">
          {candleTimeLabel
            ? `Last candle ${candleTimeLabel} · refreshed ${dataAgeLabel}`
            : `No confirmed Pyth candle yet · ${dataAgeLabel}`}
        </span>
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
          {activeAreaFocus ? (
            <ReplayAreaFocusOverlay
              key={`focus-area-${focusPulseKey}`}
              area={activeAreaFocus}
            />
          ) : null}
          {visibleActiveFocusPoint ? (
            <ReplayFocusOverlay
              key={`focus-${focusPulseKey}`}
              point={visibleActiveFocusPoint}
              coordinates={coordinateContext}
            />
          ) : null}
          {overlayAnnotations.map((annotation) => (
            <OverlayAnnotation
              key={annotation.id}
              annotation={annotation}
              coordinates={coordinateContext}
            />
          ))}
          {visibleReplayFocusPoints.map((point, index) => (
            <ReplayFocusPoint
              key={`${point.label}-${point.barIndex}-${point.price}-${index}`}
              point={point}
              coordinates={coordinateContext}
              isActive={
                visibleActiveFocusPoint !== null &&
                point.barIndex === visibleActiveFocusPoint.barIndex &&
                point.price === visibleActiveFocusPoint.price &&
                point.label === visibleActiveFocusPoint.label
              }
            />
          ))}
        </div>
      </div>

      <div className="arena-workspace-lower">
        <div className="arena-workspace-panel">
          <details className="arena-disclosure">
            <summary className="arena-disclosure-summary arena-disclosure-summary--compact">
              <div className="arena-workspace-panel-title">
                <Sparkles aria-hidden="true" size={16} />
                <h4 className="font-barlow">Trace annotations</h4>
              </div>
              <div className="arena-disclosure-meta">
                <span className="arena-chip font-barlow">
                  {overlayAnnotations.length} items
                </span>
                <ChevronDown
                  aria-hidden="true"
                  size={16}
                  className="arena-disclosure-chevron"
                />
              </div>
            </summary>
            <div className="arena-disclosure-body">
              <div className="arena-annotation-list">
                {overlayAnnotations.map((annotation) => (
                  <div key={annotation.id} className="arena-annotation-row">
                    <strong className="font-barlow">{annotation.label}</strong>
                    <span className="font-inter">{annotation.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          </details>
        </div>

        <div className="arena-workspace-panel">
          <details className="arena-disclosure">
            <summary className="arena-disclosure-summary arena-disclosure-summary--compact">
              <div className="arena-workspace-panel-title">
                <CandlestickChart aria-hidden="true" size={16} />
                <h4 className="font-barlow">Chart stack</h4>
              </div>
              <div className="arena-disclosure-meta">
                <ChevronDown
                  aria-hidden="true"
                  size={16}
                  className="arena-disclosure-chevron"
                />
              </div>
            </summary>
            <div className="arena-disclosure-body">
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
          </details>
        </div>
      </div>
    </section>
  );
}

function resolveCandleIndex(args: {
  barIndex: number;
  timeSec?: number;
  candles: CandlePoint[];
}) {
  const { barIndex, timeSec, candles } = args;

  if (timeSec !== undefined) {
    const exactIndex = candles.findIndex((candle) => Number(candle.time) === timeSec);
    if (exactIndex >= 0) return exactIndex;

    let closestIndex = 0;
    let closestDelta = Number.POSITIVE_INFINITY;
    for (let index = 0; index < candles.length; index += 1) {
      const delta = Math.abs(Number(candles[index].time) - timeSec);
      if (delta < closestDelta) {
        closestDelta = delta;
        closestIndex = index;
      }
    }
    return closestIndex;
  }

  return barIndex;
}

function xCoordinateFromAnchor(
  args: {
  barIndex: number;
  timeSec?: number;
  },
  coordinates: CoordinateContext,
) {
  const { chart } = coordinates;
  if (!chart) return null;

  if (args.timeSec !== undefined) {
    const exact = chart.timeScale().timeToCoordinate(args.timeSec as Time);
    if (exact !== null) return exact;
  }

  return chart.timeScale().logicalToCoordinate(args.barIndex as never);
}

function yCoordinateFromPrice(price: number, coordinates: CoordinateContext) {
  const { series } = coordinates;
  if (!series) return null;
  return series.priceToCoordinate(price);
}

function geometryTone(geometry: VisualGeometry) {
  if ("tone" in geometry) {
    return geometry.tone ?? "default";
  }

  return "default";
}

function OverlayAnnotation({
  annotation,
  coordinates,
}: {
  annotation: VisualAnnotation;
  coordinates: CoordinateContext;
}) {
  const geometry = annotation.geometry;

  if (!geometry) return null;

  if (geometry.kind === "line") {
    const left = xCoordinateFromAnchor(
      {
        barIndex: geometry.start.barIndex,
        timeSec: geometry.start.timeSec,
      },
      coordinates,
    );
    const top = yCoordinateFromPrice(geometry.start.price, coordinates);
    const endLeft = xCoordinateFromAnchor(
      {
        barIndex: geometry.end.barIndex,
        timeSec: geometry.end.timeSec,
      },
      coordinates,
    );
    const endTop = yCoordinateFromPrice(geometry.end.price, coordinates);
    if (left === null || top === null || endLeft === null || endTop === null) {
      return null;
    }
    const dx = endLeft - left;
    const dy = endTop - top;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

    return (
      <div
        className={`arena-overlay-line tone-${geometryTone(geometry)}`}
        style={{
          left: `${left}px`,
          top: `${top}px`,
          width: `${length}px`,
          transform: `rotate(${angle}deg)`,
        }}
      />
    );
  }

  if (geometry.kind === "fibonacci") {
    const left = xCoordinateFromAnchor(
      {
        barIndex: geometry.startBarIndex,
        timeSec: geometry.startTimeSec,
      },
      coordinates,
    );
    const right = xCoordinateFromAnchor(
      {
        barIndex: geometry.endBarIndex,
        timeSec: geometry.endTimeSec,
      },
      coordinates,
    );
    const top = yCoordinateFromPrice(geometry.highPrice, coordinates);
    const bottom = yCoordinateFromPrice(geometry.lowPrice, coordinates);
    if (left === null || right === null || top === null || bottom === null) {
      return null;
    }

    return (
      <div
        className="arena-overlay-fib"
        style={{
          left: `${Math.min(left, right)}px`,
          top: `${Math.min(top, bottom)}px`,
          width: `${Math.abs(right - left)}px`,
          height: `${Math.abs(bottom - top)}px`,
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
    const left = xCoordinateFromAnchor(
      {
        barIndex: geometry.startBarIndex,
        timeSec: geometry.startTimeSec,
      },
      coordinates,
    );
    const right = xCoordinateFromAnchor(
      {
        barIndex: geometry.endBarIndex,
        timeSec: geometry.endTimeSec,
      },
      coordinates,
    );
    const top = yCoordinateFromPrice(geometry.highPrice, coordinates);
    const bottom = yCoordinateFromPrice(geometry.lowPrice, coordinates);
    if (left === null || right === null || top === null || bottom === null) {
      return null;
    }

    return (
      <div
        className={`arena-overlay-zone tone-${geometryTone(geometry)}`}
        style={{
          left: `${Math.min(left, right)}px`,
          top: `${Math.min(top, bottom)}px`,
          width: `${Math.abs(right - left)}px`,
          height: `${Math.abs(bottom - top)}px`,
        }}
      />
    );
  }

  const left = xCoordinateFromAnchor(
    {
      barIndex: geometry.position.barIndex,
      timeSec: geometry.position.timeSec,
    },
    coordinates,
  );
  const top = yCoordinateFromPrice(geometry.position.price, coordinates);
  if (left === null || top === null) {
    return null;
  }

  return (
    <div
      className={`arena-overlay-tag tone-${geometryTone(geometry)}${annotation.type === "note" ? " is-structural" : ""}`}
      style={{
        left: `${left}px`,
        top: `${top}px`,
      }}
    >
      {geometry.text}
    </div>
  );
}

function ReplayFocusPoint({
  point,
  coordinates,
  isActive,
}: {
  point: OverlayFocusPoint;
  coordinates: CoordinateContext;
  isActive: boolean;
}) {
  const left = xCoordinateFromAnchor(
    {
      barIndex: point.barIndex,
      timeSec: point.timeSec,
    },
    coordinates,
  );
  const top = yCoordinateFromPrice(point.price, coordinates);
  if (left === null || top === null) {
    return null;
  }

  return (
    <div
      className={`arena-overlay-focus-point tone-${point.tone}${isActive ? " is-active" : ""}`}
      style={{
        left: `${left}px`,
        top: `${top}px`,
      }}
      title={point.label}
    />
  );
}

function ReplayFocusOverlay({
  point,
  coordinates,
}: {
  point: OverlayFocusPoint;
  coordinates: CoordinateContext;
}) {
  const left = xCoordinateFromAnchor(
    {
      barIndex: point.barIndex,
      timeSec: point.timeSec,
    },
    coordinates,
  );
  const top = yCoordinateFromPrice(point.price, coordinates);
  if (left === null || top === null) {
    return null;
  }

  return (
    <div className="arena-overlay-focus">
      <div
        className="arena-overlay-focus-band"
        style={{
          top: `${top}px`,
        }}
      />
      <div
        className="arena-overlay-focus-x"
        style={{
          top: `${top}px`,
        }}
      />
      <div
        className="arena-overlay-focus-y"
        style={{
          left: `${left}px`,
        }}
      />
      <div
        className={`arena-overlay-focus-label tone-${point.tone}`}
        style={{
          left: `${left}px`,
          top: `${top}px`,
        }}
      >
        {point.label}
      </div>
    </div>
  );
}

function ReplayAreaFocusOverlay({
  area,
}: {
  area: OverlayAreaFocus;
}) {
  return (
    <div className="arena-overlay-focus">
      <div
        className={`arena-overlay-area-focus tone-${area.tone}`}
        style={{
          left: `${area.left}px`,
          top: `${area.top}px`,
          width: `${Math.abs(area.right - area.left)}px`,
          height: `${Math.abs(area.bottom - area.top)}px`,
        }}
      />
      <div
        className={`arena-overlay-focus-label tone-${area.tone}`}
        style={{
          left: `${(area.left + area.right) / 2}px`,
          top: `${area.top}px`,
        }}
      >
        {area.label}
      </div>
    </div>
  );
}
