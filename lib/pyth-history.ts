import type { TradeTimeframe } from "./arena-types";

export type PythCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

const PYTH_HISTORY_BASE_URL = "https://history.pyth-lazer.dourolabs.app/v1";

const historySymbolMap: Record<string, string> = {
  "XAU/USD": "Metal.XAU/USD",
  "XAG/USD": "Metal.XAG/USD",
  "EUR/USD": "FX.EUR/USD",
};

export const pythResolutionMap: Record<TradeTimeframe, string> = {
  "15m": "15",
  "1h": "60",
  "4h": "240",
};

export const timeframeMinutesMap: Record<TradeTimeframe, number> = {
  "15m": 15,
  "1h": 60,
  "4h": 240,
};

export const analysisLookbackCandlesMap: Record<TradeTimeframe, number> = {
  "15m": 960,
  "1h": 240,
  "4h": 180,
};

const lookbackSecondsMap: Record<TradeTimeframe, number> = {
  "15m": timeframeMinutesMap["15m"] * 60 * analysisLookbackCandlesMap["15m"],
  "1h": timeframeMinutesMap["1h"] * 60 * analysisLookbackCandlesMap["1h"],
  "4h": timeframeMinutesMap["4h"] * 60 * analysisLookbackCandlesMap["4h"],
};

export function getPythHistorySymbol(marketSymbol: string) {
  return historySymbolMap[marketSymbol] ?? null;
}

export function getPythHistoryParams(
  marketSymbol: string,
  timeframe: TradeTimeframe,
  now = Math.floor(Date.now() / 1000),
) {
  const symbol = getPythHistorySymbol(marketSymbol);
  if (!symbol) return null;

  return new URLSearchParams({
    symbol,
    resolution: pythResolutionMap[timeframe],
    from: String(now - lookbackSecondsMap[timeframe]),
    to: String(now),
  });
}

export async function fetchPythHistory(
  marketSymbol: string,
  timeframe: TradeTimeframe,
): Promise<PythCandle[] | null> {
  const params = getPythHistoryParams(marketSymbol, timeframe);
  if (!params) return null;

  try {
    const response = await fetch(
      `${PYTH_HISTORY_BASE_URL}/fixed_rate@200ms/history?${params.toString()}`,
      {
        cache: "no-store",
      },
    );

    if (!response.ok) return null;

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
      return null;
    }

    const candles = payload.t
      .map((time, index) => ({
        time,
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
        time: Number(candle.time),
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
      }));

    return candles.length ? candles : null;
  } catch {
    return null;
  }
}
