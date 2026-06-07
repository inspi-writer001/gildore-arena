"use client";

import { useEffect, useRef, useState } from "react";
import { ImageDithering } from "@paper-design/shaders-react";
import { cn } from "@/lib/utils";
import type { ChartVisionDecision } from "@/lib/chart-vision-analysis";

export function BrowserSessionViewport({
  sessionId,
  sessionStatus,
  onRestart,
  onStartupExhausted,
  onDecision,
}: {
  sessionId: string;
  sessionStatus: string;
  onRestart?: () => Promise<void>;
  onStartupExhausted?: () => void;
  onDecision?: (d: ChartVisionDecision) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pointerOverlay, setPointerOverlay] = useState<{
    leftPercent: number;
    topPercent: number;
    pulseId: number;
    clicked: boolean;
    dragging: boolean;
    trail: Array<{
      leftPercent: number;
      topPercent: number;
    }>;
  } | null>(null);
  const [isStreamReady, setIsStreamReady] = useState(false);
  const [hasStreamError, setHasStreamError] = useState(false);
  const [streamRetryAttempt, setStreamRetryAttempt] = useState(0);
  const [currentActionLabel, setCurrentActionLabel] = useState<
    string | undefined
  >();
  const [ditheringSize, setDitheringSize] = useState(2);
  const [isRestarting, setIsRestarting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const lastMoveSendRef = useRef(0);
  const isDraggingRef = useRef(false);
  const ditheringRafRef = useRef<number | null>(null);
  const ditheringStartRef = useRef<number | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const hasEverConnectedRef = useRef(false);
  const startupExhaustedRef = useRef(onStartupExhausted);
  const onDecisionRef = useRef(onDecision);
  const maxStreamRetries = 3;

  useEffect(() => {
    startupExhaustedRef.current = onStartupExhausted;
  }, [onStartupExhausted]);

  useEffect(() => {
    onDecisionRef.current = onDecision;
  }, [onDecision]);

  useEffect(() => {
    function tick(ts: number) {
      if (ditheringStartRef.current === null) {
        ditheringStartRef.current = ts;
      }
      const elapsed = (ts - ditheringStartRef.current) / 1000;
      setDitheringSize(2 + 1.5 * Math.sin(elapsed * 0.7));
      ditheringRafRef.current = requestAnimationFrame(tick);
    }

    ditheringRafRef.current = requestAnimationFrame(tick);

    return () => {
      if (ditheringRafRef.current !== null) {
        cancelAnimationFrame(ditheringRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setIsStreamReady(false);
    setHasStreamError(false);
    setPointerOverlay(null);
    setCurrentActionLabel(undefined);
    setStreamRetryAttempt(0);
    hasEverConnectedRef.current = false;

    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = 1440;
    canvas.height = 900;

    const context = canvas.getContext("2d");
    if (!context) return;
    const drawingCanvas = canvas;
    const drawingContext = context;

    let disposed = false;

    function clearReconnectTimer() {
      if (reconnectTimeoutRef.current !== null) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    }

    function closeEventSource() {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    }

    function handlePayload(event: MessageEvent<string>) {
      try {
        const payload = JSON.parse(event.data) as {
          frame: string;
          mimeType: string;
          actionLabel?: string;
          visionDecision?: ChartVisionDecision;
          pointer?: {
            x: number;
            y: number;
            viewportWidth: number;
            viewportHeight: number;
            pulseId: number;
            clickAt?: number;
            dragging?: boolean;
            trail?: Array<{
              x: number;
              y: number;
            }>;
          };
        };

        setCurrentActionLabel(payload.actionLabel ?? undefined);
        if (payload.visionDecision) {
          onDecisionRef.current?.(payload.visionDecision);
        }

        const image = new Image();
        image.onload = () => {
          if (disposed) return;

          if (
            drawingCanvas.width !== image.width ||
            drawingCanvas.height !== image.height
          ) {
            drawingCanvas.width = image.width;
            drawingCanvas.height = image.height;
          }

          drawingContext.clearRect(
            0,
            0,
            drawingCanvas.width,
            drawingCanvas.height,
          );
          drawingContext.drawImage(
            image,
            0,
            0,
            drawingCanvas.width,
            drawingCanvas.height,
          );

          if (payload.pointer) {
            setPointerOverlay({
              leftPercent:
                (payload.pointer.x / payload.pointer.viewportWidth) * 100,
              topPercent:
                (payload.pointer.y / payload.pointer.viewportHeight) * 100,
              pulseId: payload.pointer.pulseId,
              clicked:
                typeof payload.pointer.clickAt === "number" &&
                Date.now() - payload.pointer.clickAt < 900,
              dragging: payload.pointer.dragging ?? false,
              trail: (payload.pointer.trail ?? []).map((point) => ({
                leftPercent: (point.x / payload.pointer!.viewportWidth) * 100,
                topPercent: (point.y / payload.pointer!.viewportHeight) * 100,
              })),
            });
          }

          setIsStreamReady(true);
          setHasStreamError(false);
          setStreamRetryAttempt(0);
          hasEverConnectedRef.current = true;
        };
        image.src = `data:${payload.mimeType};base64,${payload.frame}`;
      } catch {
        if (!disposed) {
          setHasStreamError(true);
        }
      }
    }

    function connect(attempt: number) {
      if (disposed) return;

      clearReconnectTimer();
      closeEventSource();

      const eventSource = new EventSource(
        `/api/browser-session/${sessionId}/stream`,
      );
      eventSourceRef.current = eventSource;
      eventSource.onmessage = handlePayload;
      eventSource.onerror = () => {
        if (disposed) return;

        closeEventSource();

        if (!hasEverConnectedRef.current) {
          startupExhaustedRef.current?.();
          return;
        }

        if (attempt < maxStreamRetries) {
          const nextAttempt = attempt + 1;
          const retryDelayMs = 500 * 2 ** attempt;
          setStreamRetryAttempt(nextAttempt);
          reconnectTimeoutRef.current = window.setTimeout(() => {
            connect(nextAttempt);
          }, retryDelayMs);
          return;
        }

        setHasStreamError(true);
      };
    }

    connect(0);

    return () => {
      disposed = true;
      clearReconnectTimer();
      closeEventSource();
    };
  }, [sessionId]);

  const isInteractive =
    isStreamReady && !currentActionLabel && sessionStatus === "ready";

  function canvasCoords(event: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.round((event.clientX - rect.left) * (canvas.width / rect.width)),
      y: Math.round((event.clientY - rect.top) * (canvas.height / rect.height)),
    };
  }

  function sendInteraction(event: {
    type: string;
    x: number;
    y: number;
    deltaX?: number;
    deltaY?: number;
  }) {
    void fetch(`/api/browser-session/${sessionId}/interact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    }).catch(() => {});
  }

  return (
    <div className="relative h-full overflow-hidden rounded-[20px] border border-[rgba(18,18,18,0.1)] bg-[rgba(17,17,17,0.04)]">
      {hasStreamError ? (
        <button
          type="button"
          className={cn(
            "block h-full w-full cursor-pointer border-0 bg-transparent p-0",
            isRestarting && "cursor-wait pointer-events-none",
          )}
          disabled={isRestarting || !onRestart}
          onClick={async () => {
            if (!onRestart) return;
            setIsRestarting(true);
            try {
              await onRestart();
            } finally {
              setIsRestarting(false);
              setHasStreamError(false);
            }
          }}
        >
          <ImageDithering
            image="https://res.cloudinary.com/ddlz0zesx/image/upload/v1777216792/enter_the_arena_smth_qazlcz.png"
            colorBack="#000c38"
            colorFront="#94ffaf"
            colorHighlight="#eaff94"
            originalColors={false}
            inverted={false}
            type="8x8"
            size={ditheringSize}
            colorSteps={2}
            fit="cover"
            width="100%"
            height="100%"
          />
        </button>
      ) : (
        <>
          <canvas
            ref={canvasRef}
            className={cn(
              "block h-full w-full border-0 bg-[#111]",
              isInteractive && "cursor-grab",
              isDragging && "cursor-grabbing select-none",
            )}
            onMouseDown={(event) => {
              if (!isInteractive) return;
              isDraggingRef.current = true;
              setIsDragging(true);
              sendInteraction({ ...canvasCoords(event), type: "mousedown" });
            }}
            onMouseMove={(event) => {
              if (!isInteractive || !isDraggingRef.current) return;
              const now = Date.now();
              if (now - lastMoveSendRef.current < 40) return;
              lastMoveSendRef.current = now;
              sendInteraction({ ...canvasCoords(event), type: "mousemove" });
            }}
            onMouseUp={(event) => {
              if (!isInteractive) return;
              isDraggingRef.current = false;
              setIsDragging(false);
              sendInteraction({ ...canvasCoords(event), type: "mouseup" });
            }}
            onMouseLeave={(event) => {
              if (!isInteractive) return;
              isDraggingRef.current = false;
              setIsDragging(false);
              sendInteraction({ ...canvasCoords(event), type: "mouseup" });
            }}
            onWheel={(event) => {
              if (!isInteractive) return;
              event.preventDefault();
              sendInteraction({
                ...canvasCoords(event),
                type: "wheel",
                deltaX: event.deltaX,
                deltaY: event.deltaY,
              });
            }}
          />
          {pointerOverlay ? (
            <div
              key={`${pointerOverlay.pulseId}-${pointerOverlay.clicked ? "click" : "move"}`}
              className="pointer-events-none absolute inset-0 z-[2]"
            >
              {pointerOverlay.trail.length > 1 ? (
                <svg
                  className="absolute inset-0 overflow-visible"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                >
                  <polyline
                    points={pointerOverlay.trail
                      .map((point) => `${point.leftPercent},${point.topPercent}`)
                      .join(" ")}
                    fill="none"
                    stroke={
                      pointerOverlay.dragging
                        ? "rgba(214,102,37,0.82)"
                        : "rgba(18,18,18,0.55)"
                    }
                    strokeWidth={pointerOverlay.dragging ? "0.45" : "0.35"}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={pointerOverlay.dragging ? "none" : "1.5 1.2"}
                  />
                </svg>
              ) : null}
              <div
                className="pointer-events-none absolute z-[2] h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2"
                style={{
                  left: `${pointerOverlay.leftPercent}%`,
                  top: `${pointerOverlay.topPercent}%`,
                }}
              >
                <span
                  className={cn(
                    "absolute inset-0 rounded-full border-2 border-[rgba(18,18,18,0.9)] bg-[rgba(255,255,255,0.82)] shadow-[0_0_0_3px_rgba(255,255,255,0.45)]",
                    pointerOverlay.dragging &&
                      "!border-[rgba(214,102,37,0.92)] ![box-shadow:0_0_0_3px_rgba(214,102,37,0.18)]",
                  )}
                />
                {pointerOverlay.clicked ? (
                  <span className="animate-pointer-pulse absolute -inset-[10px] rounded-full border-2 border-[rgba(214,102,37,0.78)]" />
                ) : null}
              </div>
            </div>
          ) : null}
          {!isStreamReady ? (
            <div className="absolute inset-0 block">
              <ImageDithering
                image="https://res.cloudinary.com/ddlz0zesx/image/upload/v1777216792/enter_the_arena_smth_qazlcz.png"
                colorBack="#000c38"
                colorFront="#94ffaf"
                colorHighlight="#eaff94"
                originalColors={false}
                inverted={false}
                type="8x8"
                size={ditheringSize}
                colorSteps={2}
                fit="cover"
                width="100%"
                height="100%"
              />
              <div className="pointer-events-none absolute inset-0 flex items-end justify-start p-4">
                <div className="rounded-[12px] bg-[rgba(0,12,56,0.72)] px-3 py-2 text-[#94ffaf] shadow-[0_10px_24px_rgba(0,0,0,0.18)] backdrop-blur-[8px]">
                  <span className="block font-barlow text-[11px] font-semibold uppercase tracking-[0.14em]">
                    {streamRetryAttempt > 0
                      ? `Retrying stream (${streamRetryAttempt}/${maxStreamRetries})`
                      : "Connecting stream"}
                  </span>
                </div>
              </div>
            </div>
          ) : null}
          {isStreamReady && currentActionLabel ? (
            <div className="pointer-events-none absolute bottom-[14px] left-[14px] rounded-[6px] bg-[rgba(0,12,56,0.72)] px-[10px] py-[5px] font-barlow text-[12px] font-medium tracking-[0.01em] text-[#94ffaf] backdrop-blur-[6px]">
              {currentActionLabel}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
