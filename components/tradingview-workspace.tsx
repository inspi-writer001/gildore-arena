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
import { cn } from "@/lib/utils";

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
        tone: geometry.tone ?? "zone",
      },
      {
        barIndex: geometry.endBarIndex,
        timeSec: geometry.endTimeSec,
        price: geometry.lowPrice,
        label: `${annotation.label} low`,
        tone: geometry.tone ?? "zone",
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
      tone: geometry.tone ?? "zone",
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

  // Suppress unused variable warning — priceRange is kept for future use
  void priceRange;

  return (
    <section className="border border-[rgba(18,18,18,0.08)] rounded-[18px] bg-[rgba(255,255,255,0.78)] shadow-[0_18px_40px_rgba(0,0,0,0.05)] backdrop-blur-[16px] p-5">
      {/* arena-surface-header */}
      <div className="flex items-center justify-between gap-3">
        {/* arena-surface-title */}
        <div className="flex items-center gap-[10px]">
          <CandlestickChart aria-hidden="true" size={18} />
          <h3 className="m-0 text-[14px] font-semibold tracking-[0.06em] uppercase font-barlow">
            Chart workspace
          </h3>
        </div>
        {/* arena-workspace-meta */}
        <div className="flex flex-wrap gap-[10px] justify-end">
          {/* arena-tool-chip */}
          <button
            className="inline-flex items-center gap-2 min-h-[40px] px-[14px] border border-[rgba(18,18,18,0.08)] rounded-full bg-[rgba(255,255,255,0.88)] text-[rgba(18,18,18,0.76)] text-[12px] font-semibold tracking-[0.08em] uppercase cursor-pointer font-barlow"
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
          {/* arena-chip */}
          <span className="inline-flex items-center min-h-[32px] px-3 rounded-full border border-[rgba(18,18,18,0.08)] bg-[rgba(255,255,255,0.88)] text-[rgba(18,18,18,0.48)] text-[11px] font-semibold tracking-[0.14em] uppercase font-barlow">
            {marketSymbol}
          </span>
          <span className="inline-flex items-center min-h-[32px] px-3 rounded-full border border-[rgba(18,18,18,0.08)] bg-[rgba(255,255,255,0.88)] text-[rgba(18,18,18,0.48)] text-[11px] font-semibold tracking-[0.14em] uppercase font-barlow">
            {timeframe}
          </span>
          {/* arena-pill with is-* tone */}
          <span
            className={cn(
              "inline-flex items-center justify-center w-fit min-h-[28px] px-[10px] rounded-full text-[11px] font-semibold tracking-[0.14em] uppercase font-barlow",
              marketNewsState === "supportive" && "bg-[rgba(26,127,70,0.12)] text-[#1a7f46]",
              marketNewsState === "neutral" && "bg-[rgba(18,18,18,0.06)] text-[rgba(18,18,18,0.64)]",
              marketNewsState === "risk" && "bg-[rgba(163,48,48,0.12)] text-[#a33030]",
            )}
          >
            {marketNewsState}
          </span>
          {/* arena-chip */}
          <span className="inline-flex items-center min-h-[32px] px-3 rounded-full border border-[rgba(18,18,18,0.08)] bg-[rgba(255,255,255,0.88)] text-[rgba(18,18,18,0.48)] text-[11px] font-semibold tracking-[0.14em] uppercase font-barlow">
            News {newsFreshnessLabel}
          </span>
          {/* arena-chip with tone-live / tone-error */}
          <span
            className={cn(
              "inline-flex items-center min-h-[32px] px-3 rounded-full border border-[rgba(18,18,18,0.08)] bg-[rgba(255,255,255,0.88)] text-[rgba(18,18,18,0.48)] text-[11px] font-semibold tracking-[0.14em] uppercase font-barlow",
              dataSourceTone === "live" && "bg-[rgba(26,127,70,0.1)] text-[#1a7f46] border-[rgba(26,127,70,0.2)]",
              dataSourceTone === "error" && "bg-[rgba(163,48,48,0.1)] text-[#a33030] border-[rgba(163,48,48,0.2)]",
            )}
          >
            {dataSourceLabel}
          </span>
          {livePrice !== null ? (
            <span className="inline-flex items-center min-h-[32px] px-3 rounded-full border border-[rgba(18,18,18,0.08)] bg-[rgba(255,255,255,0.88)] text-[rgba(18,18,18,0.48)] text-[11px] font-semibold tracking-[0.14em] uppercase font-barlow">
              {livePrice.toFixed(marketSymbol === "EUR/USD" ? 4 : 2)}
              {liveDeltaPercent !== null ? (
                <span
                  className={cn(
                    "ml-1",
                    liveDeltaPercent >= 0 ? "text-[#1a7f46]" : "text-[#a33030]",
                  )}
                >
                  {liveDeltaPercent >= 0 ? "+" : ""}
                  {liveDeltaPercent.toFixed(2)}%
                </span>
              ) : null}
            </span>
          ) : null}
          {trace ? (
            <span className="inline-flex items-center min-h-[32px] px-3 rounded-full border border-[rgba(18,18,18,0.08)] bg-[rgba(255,255,255,0.88)] text-[rgba(18,18,18,0.48)] text-[11px] font-semibold tracking-[0.14em] uppercase font-barlow">
              {trace.updatedAt}
            </span>
          ) : null}
        </div>
      </div>

      {/* arena-workspace-toolbar */}
      <div className="flex flex-wrap gap-[10px] mt-4" aria-label="Workspace layers">
        {/* arena-tool-chip is-static */}
        <button
          className="inline-flex items-center gap-2 min-h-[40px] px-[14px] border border-[rgba(18,18,18,0.08)] rounded-full bg-[rgba(255,255,255,0.88)] text-[rgba(18,18,18,0.76)] text-[12px] font-semibold tracking-[0.08em] uppercase cursor-default font-barlow"
          type="button"
        >
          <Layers3 aria-hidden="true" size={14} />
          Agent layers
        </button>
        <button
          className={cn(
            "inline-flex items-center gap-2 min-h-[40px] px-[14px] border border-[rgba(18,18,18,0.08)] rounded-full bg-[rgba(255,255,255,0.88)] text-[rgba(18,18,18,0.76)] text-[12px] font-semibold tracking-[0.08em] uppercase cursor-pointer font-barlow",
            visibleLayers.trendline && "border-[rgba(18,18,18,0.14)] bg-[rgba(18,18,18,0.08)] text-[#111111]",
          )}
          type="button"
          onClick={() => toggleLayer("trendline")}
          aria-pressed={visibleLayers.trendline}
        >
          <Route aria-hidden="true" size={14} />
          Trendline
        </button>
        <button
          className={cn(
            "inline-flex items-center gap-2 min-h-[40px] px-[14px] border border-[rgba(18,18,18,0.08)] rounded-full bg-[rgba(255,255,255,0.88)] text-[rgba(18,18,18,0.76)] text-[12px] font-semibold tracking-[0.08em] uppercase cursor-pointer font-barlow",
            visibleLayers.fibonacci && "border-[rgba(18,18,18,0.14)] bg-[rgba(18,18,18,0.08)] text-[#111111]",
          )}
          type="button"
          onClick={() => toggleLayer("fibonacci")}
          aria-pressed={visibleLayers.fibonacci}
        >
          <Sparkles aria-hidden="true" size={14} />
          Fibonacci
        </button>
        <button
          className={cn(
            "inline-flex items-center gap-2 min-h-[40px] px-[14px] border border-[rgba(18,18,18,0.08)] rounded-full bg-[rgba(255,255,255,0.88)] text-[rgba(18,18,18,0.76)] text-[12px] font-semibold tracking-[0.08em] uppercase cursor-pointer font-barlow",
            visibleLayers.zone && "border-[rgba(18,18,18,0.14)] bg-[rgba(18,18,18,0.08)] text-[#111111]",
          )}
          type="button"
          onClick={() => toggleLayer("zone")}
          aria-pressed={visibleLayers.zone}
        >
          <Layers3 aria-hidden="true" size={14} />
          Zones
        </button>
        <button
          className={cn(
            "inline-flex items-center gap-2 min-h-[40px] px-[14px] border border-[rgba(18,18,18,0.08)] rounded-full bg-[rgba(255,255,255,0.88)] text-[rgba(18,18,18,0.76)] text-[12px] font-semibold tracking-[0.08em] uppercase cursor-pointer font-barlow",
            visibleLayers.levels && "border-[rgba(18,18,18,0.14)] bg-[rgba(18,18,18,0.08)] text-[#111111]",
          )}
          type="button"
          onClick={() => toggleLayer("levels")}
          aria-pressed={visibleLayers.levels}
        >
          <Eye aria-hidden="true" size={14} />
          Levels
        </button>
      </div>

      {/* arena-workspace-data-age */}
      <div className="grid gap-1 mt-[14px]">
        <span className="text-[rgba(18,18,18,0.46)] text-[11px] font-semibold tracking-[0.12em] uppercase font-barlow">
          Feed status
        </span>
        <span className="text-[rgba(18,18,18,0.62)] text-[14px] leading-[1.5] font-inter">
          {candleTimeLabel
            ? `Last candle ${candleTimeLabel} · refreshed ${dataAgeLabel}`
            : `No confirmed Pyth candle yet · ${dataAgeLabel}`}
        </span>
      </div>

      {/* arena-replay-bar */}
      <div className="grid gap-[14px] mt-4 p-4 border border-[rgba(18,18,18,0.08)] rounded-[18px] bg-[rgba(255,255,255,0.76)]">
        {/* arena-replay-controls */}
        <div className="flex items-center gap-[10px]">
          {/* arena-replay-button */}
          <button
            className="inline-flex items-center justify-center gap-2 min-h-[40px] px-[14px] border border-[rgba(18,18,18,0.08)] rounded-full bg-[rgba(250,250,247,0.92)] text-[rgba(18,18,18,0.78)] cursor-pointer"
            type="button"
            onClick={() => {
              setIsPlaying(false);
              setReplayStep((currentStep) => Math.max(1, currentStep - 1));
            }}
            aria-label="Previous replay step"
          >
            <ChevronLeft aria-hidden="true" size={16} />
          </button>
          {/* arena-replay-button is-primary */}
          <button
            className="inline-flex items-center justify-center gap-2 min-h-[40px] px-[14px] border border-[rgba(18,18,18,0.08)] rounded-full bg-[#111111] text-[#f7f7f3] cursor-pointer"
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
          {/* arena-replay-button */}
          <button
            className="inline-flex items-center justify-center gap-2 min-h-[40px] px-[14px] border border-[rgba(18,18,18,0.08)] rounded-full bg-[rgba(250,250,247,0.92)] text-[rgba(18,18,18,0.78)] cursor-pointer"
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

        {/* arena-replay-track */}
        <div className="flex flex-wrap items-center gap-[10px]">
          {events.map((event, index) => {
            const step = index + 1;
            const isVisible = step <= replayStep;
            const isActive = step === replayStep;

            return (
              <button
                key={event.id}
                className={cn(
                  "flex items-center gap-2 min-h-[36px] px-[10px] border border-[rgba(18,18,18,0.08)] rounded-full bg-[rgba(250,250,247,0.9)] text-[rgba(18,18,18,0.44)] cursor-pointer",
                  isVisible && "text-[rgba(18,18,18,0.76)]",
                  isActive && "border-[rgba(18,18,18,0.16)] bg-[rgba(18,18,18,0.06)]",
                )}
                type="button"
                onClick={() => {
                  setIsPlaying(false);
                  setReplayStep(step);
                }}
                aria-label={`Jump to ${event.title}`}
              >
                {/* arena-replay-dot */}
                <span
                  className={cn(
                    "w-2 h-2 rounded-full bg-[rgba(18,18,18,0.2)]",
                    isVisible && "bg-[rgba(18,18,18,0.58)]",
                    isActive && "bg-[#111111]",
                  )}
                />
                <span className="font-barlow">{event.timestamp}</span>
              </button>
            );
          })}
        </div>

        {activeEvent ? (
          /* arena-replay-summary */
          <div className="grid gap-1">
            <strong className="text-[15px] font-semibold font-barlow">{activeEvent.title}</strong>
            <span className="text-[rgba(18,18,18,0.62)] text-[14px] leading-[1.6] font-inter">
              {activeEvent.detail}
            </span>
          </div>
        ) : null}
      </div>

      {/* arena-workspace-frame */}
      <div className="relative min-h-[560px] mt-[18px] overflow-hidden rounded-[20px] border border-[rgba(18,18,18,0.08)] bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(247,247,243,0.72)),linear-gradient(rgba(18,18,18,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(18,18,18,0.04)_1px,transparent_1px)] [background-size:auto,100%_52px,52px_100%]">
        {/* arena-tradingview-root */}
        <div ref={chartContainerRef} className="w-full min-h-[560px]" />

        {/* arena-lightweight-overlay */}
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
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

      {/* arena-workspace-lower */}
      <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)] gap-4 mt-4">
        {/* arena-workspace-panel */}
        <div className="grid gap-3 p-5 rounded-[18px] bg-[rgba(255,255,255,0.9)] border border-[rgba(18,18,18,0.08)]">
          {/* arena-disclosure — group for group-open: variant */}
          <details className="group grid gap-0 open:gap-[14px]">
            {/* arena-disclosure-summary arena-disclosure-summary--compact */}
            <summary className="flex items-center justify-between gap-3 list-none cursor-pointer [&::-webkit-details-marker]:hidden min-h-[40px]">
              {/* arena-workspace-panel-title */}
              <div className="flex items-center gap-[10px]">
                <Sparkles aria-hidden="true" size={16} />
                <h4 className="m-0 text-[14px] font-semibold tracking-[0.06em] uppercase font-barlow">
                  Trace annotations
                </h4>
              </div>
              {/* arena-disclosure-meta */}
              <div className="inline-flex items-center gap-[10px]">
                {/* arena-chip */}
                <span className="inline-flex items-center min-h-[32px] px-3 rounded-full border border-[rgba(18,18,18,0.08)] bg-[rgba(255,255,255,0.88)] text-[rgba(18,18,18,0.48)] text-[11px] font-semibold tracking-[0.14em] uppercase font-barlow">
                  {overlayAnnotations.length} items
                </span>
                {/* arena-disclosure-chevron */}
                <ChevronDown
                  aria-hidden="true"
                  size={16}
                  className="text-[rgba(18,18,18,0.48)] transition-transform duration-[160ms] group-open:rotate-180"
                />
              </div>
            </summary>
            {/* arena-disclosure-body */}
            <div className="grid gap-[14px]">
              {/* arena-annotation-list */}
              <div className="grid gap-[10px] mt-[18px]">
                {overlayAnnotations.map((annotation) => (
                  /* arena-annotation-row */
                  <div key={annotation.id} className="grid gap-[6px] p-[14px] rounded-[16px] bg-[rgba(250,250,247,0.92)]">
                    <strong className="text-[15px] font-semibold font-barlow">{annotation.label}</strong>
                    <span className="text-[rgba(18,18,18,0.62)] text-[14px] leading-[1.6] font-inter">{annotation.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          </details>
        </div>

        {/* arena-workspace-panel */}
        <div className="grid gap-3 p-5 rounded-[18px] bg-[rgba(255,255,255,0.9)] border border-[rgba(18,18,18,0.08)]">
          {/* arena-disclosure */}
          <details className="group grid gap-0 open:gap-[14px]">
            {/* arena-disclosure-summary arena-disclosure-summary--compact */}
            <summary className="flex items-center justify-between gap-3 list-none cursor-pointer [&::-webkit-details-marker]:hidden min-h-[40px]">
              {/* arena-workspace-panel-title */}
              <div className="flex items-center gap-[10px]">
                <CandlestickChart aria-hidden="true" size={16} />
                <h4 className="m-0 text-[14px] font-semibold tracking-[0.06em] uppercase font-barlow">
                  Chart stack
                </h4>
              </div>
              {/* arena-disclosure-meta */}
              <div className="inline-flex items-center gap-[10px]">
                {/* arena-disclosure-chevron */}
                <ChevronDown
                  aria-hidden="true"
                  size={16}
                  className="text-[rgba(18,18,18,0.48)] transition-transform duration-[160ms] group-open:rotate-180"
                />
              </div>
            </summary>
            {/* arena-disclosure-body */}
            <div className="grid gap-[14px]">
              {/* arena-workspace-note-list */}
              <div className="grid gap-[10px]">
                {/* arena-watch-row */}
                <div className="grid gap-[6px] p-[14px] rounded-[16px] bg-[rgba(250,250,247,0.92)]">
                  <strong className="text-[15px] font-semibold font-barlow">Current layer</strong>
                  <span className="text-[rgba(18,18,18,0.62)] text-[14px] leading-[1.6] font-inter">
                    Lightweight Charts renders the actual candles and price levels.
                  </span>
                </div>
                {/* arena-watch-row */}
                <div className="grid gap-[6px] p-[14px] rounded-[16px] bg-[rgba(250,250,247,0.92)]">
                  <strong className="text-[15px] font-semibold font-barlow">Annotation model</strong>
                  <span className="text-[rgba(18,18,18,0.62)] text-[14px] leading-[1.6] font-inter">
                    Fibs, trendlines, zones, and markers now reveal by replay step from trace data.
                  </span>
                </div>
                {/* arena-watch-row */}
                <div className="grid gap-[6px] p-[14px] rounded-[16px] bg-[rgba(250,250,247,0.92)]">
                  <strong className="text-[15px] font-semibold font-barlow">Upgrade path</strong>
                  <span className="text-[rgba(18,18,18,0.62)] text-[14px] leading-[1.6] font-inter">
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
        className={cn(
          "absolute h-[2px] origin-left",
          geometryTone(geometry) === "muted" ? "bg-[rgba(17,17,17,0.32)]" : "bg-[rgba(17,17,17,0.82)]",
        )}
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
      { barIndex: geometry.startBarIndex, timeSec: geometry.startTimeSec },
      coordinates,
    );
    if (left === null) return null;

    const isMuted = geometryTone(geometry) === "muted";
    const levels = geometry.levels ?? [0, 0.5, 0.618, 0.7, 0.786, 1];
    const priceRange = geometry.highPrice - geometry.lowPrice;

    const levelData = levels.flatMap((level) => {
      const price = geometry.highPrice - priceRange * level;
      const y = yCoordinateFromPrice(price, coordinates);
      return y !== null ? [{ level, price, y }] : [];
    });

    if (!levelData.length) return null;

    return (
      <>
        {levelData.map(({ level, price, y }) => (
          <div
            key={`${annotation.id}-${level}`}
            className="absolute"
            style={{ left: `${left}px`, top: `${y}px`, right: 0 }}
          >
            <div
              className={cn(
                "absolute inset-x-0 top-0 border-t border-dashed",
                isMuted ? "border-[rgba(17,17,17,0.1)]" : "border-[rgba(17,17,17,0.22)]",
              )}
            />
            <span
              className={cn(
                "absolute right-1 -top-[11px] text-[9px] font-mono tabular-nums leading-none whitespace-nowrap",
                isMuted ? "text-[rgba(17,17,17,0.28)]" : "text-[rgba(17,17,17,0.54)]",
              )}
            >
              {level} · {price.toFixed(2)}
            </span>
          </div>
        ))}
      </>
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
        className="absolute border border-dashed border-[rgba(17,17,17,0.28)] rounded-[16px] bg-[rgba(17,17,17,0.05)]"
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

  const tone = geometryTone(geometry);
  const isStructural = annotation.type === "note";

  return (
    <div
      className={cn(
        "absolute inline-flex items-center min-h-[28px] px-[10px] rounded-full text-[11px] font-bold tracking-[0.1em] uppercase -translate-x-1/2 -translate-y-1/2",
        tone === "entry" && "bg-[rgba(17,17,17,0.92)] text-[#f7f7f3]",
        tone === "stop" && "bg-[rgba(163,48,48,0.12)] text-[#a33030]",
        tone === "target" && "bg-[rgba(26,127,70,0.12)] text-[#1a7f46]",
        (tone === "default" || tone === "muted" || tone === "zone") &&
          "bg-[rgba(17,17,17,0.92)] text-[#f7f7f3]",
        isStructural &&
          "z-[5] min-h-[30px] px-[11px] bg-[rgba(17,17,17,0.92)] text-[#f7f7f3] shadow-[0_8px_20px_rgba(17,17,17,0.12),0_0_0_4px_rgba(255,255,255,0.66)]",
      )}
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
      className={cn(
        "absolute z-[4] w-3 h-3 border-2 border-[rgba(17,17,17,0.72)] rounded-full bg-[rgba(255,255,255,0.94)] shadow-[0_0_0_4px_rgba(17,17,17,0.08)] -translate-x-1/2 -translate-y-1/2",
        point.tone === "entry" && "border-[#1a7f46]",
        point.tone === "stop" && "border-[#a33030]",
        point.tone === "target" && "border-[#1a7f46]",
        point.tone === "zone" && "border-[#a16b14]",
        isActive && "w-4 h-4 shadow-[0_0_0_5px_rgba(17,17,17,0.12),0_0_0_10px_rgba(17,17,17,0.05)] animate-[focus-pulse_520ms_ease-out]",
      )}
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
    /* arena-overlay-focus */
    <div className="absolute inset-0 pointer-events-none">
      {/* arena-overlay-focus-band */}
      <div
        className="absolute left-0 right-0 h-[64px] bg-[linear-gradient(180deg,rgba(17,17,17,0)_0%,rgba(17,17,17,0.045)_50%,rgba(17,17,17,0)_100%)] -translate-y-1/2"
        style={{
          top: `${top}px`,
        }}
      />
      {/* arena-overlay-focus-x */}
      <div
        className="absolute left-0 right-0 h-px border-t border-dashed border-[rgba(18,18,18,0.18)]"
        style={{
          top: `${top}px`,
        }}
      />
      {/* arena-overlay-focus-y */}
      <div
        className="absolute top-0 bottom-0 w-px border-l border-dashed border-[rgba(18,18,18,0.18)]"
        style={{
          left: `${left}px`,
        }}
      />
      {/* arena-overlay-focus-label */}
      <div
        className={cn(
          "absolute z-[3] px-[10px] py-[6px] rounded-full bg-[rgba(17,17,17,0.92)] text-[#f7f7f3] text-[11px] font-semibold tracking-[0.06em] uppercase translate-x-3 -translate-y-[30px] whitespace-nowrap",
          point.tone === "entry" && "bg-[rgba(26,127,70,0.94)]",
          point.tone === "stop" && "bg-[rgba(163,48,48,0.94)]",
          point.tone === "target" && "bg-[rgba(26,127,70,0.94)]",
          point.tone === "zone" && "bg-[rgba(161,107,20,0.94)]",
        )}
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
    /* arena-overlay-focus */
    <div className="absolute inset-0 pointer-events-none">
      {/* arena-overlay-area-focus */}
      <div
        className={cn(
          "absolute z-[2] border-2 border-[rgba(17,17,17,0.26)] rounded-[14px] bg-[rgba(17,17,17,0.04)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.24),0_0_0_6px_rgba(17,17,17,0.05)] animate-[focus-pulse_520ms_ease-out]",
          area.tone === "zone" &&
            "border-[rgba(161,107,20,0.48)] bg-[rgba(161,107,20,0.08)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.28),0_0_0_6px_rgba(161,107,20,0.08)]",
        )}
        style={{
          left: `${area.left}px`,
          top: `${area.top}px`,
          width: `${Math.abs(area.right - area.left)}px`,
          height: `${Math.abs(area.bottom - area.top)}px`,
        }}
      />
      {/* arena-overlay-focus-label */}
      <div
        className={cn(
          "absolute z-[3] px-[10px] py-[6px] rounded-full bg-[rgba(17,17,17,0.92)] text-[#f7f7f3] text-[11px] font-semibold tracking-[0.06em] uppercase translate-x-3 -translate-y-[30px] whitespace-nowrap",
          area.tone === "entry" && "bg-[rgba(26,127,70,0.94)]",
          area.tone === "stop" && "bg-[rgba(163,48,48,0.94)]",
          area.tone === "target" && "bg-[rgba(26,127,70,0.94)]",
          area.tone === "zone" && "bg-[rgba(161,107,20,0.94)]",
        )}
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
