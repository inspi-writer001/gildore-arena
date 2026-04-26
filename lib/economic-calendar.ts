import type { ConfluenceState } from "./arena-types";

export type CalendarEventItem = {
  headline: string;
  sourceLabel: string;
  publishedAtLabel: string;
  note: string;
  state: ConfluenceState;
  url?: string;
  eventAtMs: number | null;
};

export type MarketCalendarPayload = {
  items: CalendarEventItem[];
  overallState: ConfluenceState;
  overallReason: string;
};

type TradingEconomicsCalendarRow = {
  CalendarId?: string | number;
  Date?: string;
  Country?: string;
  Category?: string;
  Event?: string;
  Source?: string;
  SourceURL?: string;
  URL?: string;
  Importance?: number;
};

const TRADING_ECONOMICS_API_BASE_URL = "https://api.tradingeconomics.com";
const CALENDAR_IMPACT_WINDOW_BACK_HOURS = 6;
const CALENDAR_IMPACT_WINDOW_FORWARD_HOURS = 36;

const marketCalendarCountryMap: Record<string, string[]> = {
  "XAU/USD": ["united states"],
  "XAG/USD": ["united states"],
  "EUR/USD": ["united states", "euro area"],
};

const majorEventKeywords = [
  "fomc",
  "interest rate",
  "rate decision",
  "powell",
  "ecb",
  "lagarde",
  "cpi",
  "inflation",
  "pce",
  "payroll",
  "non farm payroll",
  "nfp",
  "gdp",
  "pmi",
  "unemployment",
  "retail sales",
];

const dominantEventWeights: Record<string, number> = {
  fomc: 1.45,
  "interest rate": 1.35,
  "rate decision": 1.35,
  ecb: 1.35,
  cpi: 1.25,
  inflation: 1.15,
  pce: 1.1,
  payroll: 1.2,
  "non farm payroll": 1.35,
  nfp: 1.35,
  gdp: 1.05,
  pmi: 1,
  unemployment: 0.95,
  "retail sales": 0.95,
  powell: 1.15,
  lagarde: 1.05,
};

const marketEventWeightBoosts: Record<string, Record<string, number>> = {
  "XAU/USD": {
    fomc: 1.15,
    "interest rate": 1.15,
    "rate decision": 1.15,
    cpi: 1.12,
    inflation: 1.08,
    payroll: 1.08,
    nfp: 1.1,
    powell: 1.12,
  },
  "XAG/USD": {
    fomc: 1.1,
    "interest rate": 1.1,
    "rate decision": 1.1,
    cpi: 1.08,
    inflation: 1.06,
    payroll: 1.04,
    nfp: 1.06,
  },
  "EUR/USD": {
    ecb: 1.18,
    "interest rate": 1.12,
    "rate decision": 1.12,
    cpi: 1.08,
    inflation: 1.08,
    payroll: 1.08,
    nfp: 1.1,
    lagarde: 1.12,
    fomc: 1.08,
  },
};

function toEventTimestamp(value: string | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function toRelativeEventLabel(eventAtMs: number | null) {
  if (!eventAtMs) return "Schedule pending";

  const deltaMinutes = Math.round((eventAtMs - Date.now()) / (1000 * 60));
  const absMinutes = Math.abs(deltaMinutes);

  if (absMinutes < 60) {
    return deltaMinutes >= 0 ? `in ${Math.max(1, absMinutes)}m` : `${Math.max(1, absMinutes)}m ago`;
  }

  const absHours = Math.round(absMinutes / 60);
  if (absHours < 24) {
    return deltaMinutes >= 0 ? `in ${absHours}h` : `${absHours}h ago`;
  }

  const absDays = Math.round(absHours / 24);
  return deltaMinutes >= 0 ? `in ${absDays}d` : `${absDays}d ago`;
}

function isWithinCalendarWindow(eventAtMs: number | null) {
  if (!eventAtMs) return false;

  const deltaHours = (eventAtMs - Date.now()) / (1000 * 60 * 60);
  return (
    deltaHours >= -CALENDAR_IMPACT_WINDOW_BACK_HOURS &&
    deltaHours <= CALENDAR_IMPACT_WINDOW_FORWARD_HOURS
  );
}

function getTimeRiskWeight(eventAtMs: number | null) {
  if (!eventAtMs) return 0.8;

  const deltaHours = Math.abs((eventAtMs - Date.now()) / (1000 * 60 * 60));
  if (deltaHours <= 1) return 1.45;
  if (deltaHours <= 3) return 1.35;
  if (deltaHours <= 8) return 1.15;
  if (deltaHours <= 24) return 1;
  return 0.8;
}

function getKeywordIntensity(text: string) {
  const normalized = text.toLowerCase();
  return majorEventKeywords.filter((keyword) => normalized.includes(keyword)).length;
}

function getEventRiskWeight(marketSymbol: string, text: string) {
  const normalized = text.toLowerCase();
  const matchedKeywords = majorEventKeywords.filter((keyword) =>
    normalized.includes(keyword),
  );

  if (!matchedKeywords.length) return 1;

  const baseWeight = matchedKeywords.reduce((sum, keyword) => {
    return sum + (dominantEventWeights[keyword] ?? 0.85);
  }, 0);

  const marketBoost = matchedKeywords.reduce((boost, keyword) => {
    return boost * (marketEventWeightBoosts[marketSymbol]?.[keyword] ?? 1);
  }, 1);

  return baseWeight * marketBoost;
}

function buildCalendarNote(marketSymbol: string, country: string, event: string) {
  return `Scheduled macro event for ${country} can distort ${marketSymbol} volatility around ${event}. Treat this as execution risk, not automatic trade direction.`;
}

function toTradingEconomicsUrl(path: string | undefined) {
  if (!path) return undefined;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  if (!path.startsWith("/")) return `${TRADING_ECONOMICS_API_BASE_URL}/${path}`;
  return `https://tradingeconomics.com${path}`;
}

function normalizeCalendarRows(
  marketSymbol: string,
  rows: TradingEconomicsCalendarRow[],
): CalendarEventItem[] {
  return rows
    .map((row) => {
      const eventAtMs = toEventTimestamp(row.Date);
      const country = row.Country?.trim() || "Macro";
      const event = row.Event?.trim() || row.Category?.trim() || "Economic event";
      const importance = Number(row.Importance ?? 0);
      const headline = `${country}: ${event}`;

      return {
        headline,
        sourceLabel: "Economic Calendar",
        publishedAtLabel: toRelativeEventLabel(eventAtMs),
        note: buildCalendarNote(marketSymbol, country, event),
        state: importance >= 3 && isWithinCalendarWindow(eventAtMs) ? "risk" : "neutral",
        url: toTradingEconomicsUrl(row.URL),
        eventAtMs,
      } satisfies CalendarEventItem;
    })
    .filter((item) => isWithinCalendarWindow(item.eventAtMs))
    .sort((a, b) => (a.eventAtMs ?? Number.MAX_SAFE_INTEGER) - (b.eventAtMs ?? Number.MAX_SAFE_INTEGER))
    .slice(0, 6);
}

function aggregateCalendarConfluence(
  marketSymbol: string,
  items: CalendarEventItem[],
): {
  overallState: ConfluenceState;
  overallReason: string;
} {
  if (!items.length) {
    return {
      overallState: "neutral",
      overallReason:
        "No high-impact scheduled macro events are close enough to the current scan window to force execution risk.",
    };
  }

  let riskScore = 0;
  let strongestEvent: CalendarEventItem | null = null;
  let strongestEventScore = 0;

  for (const item of items) {
    const compositeText = `${item.headline} ${item.note}`;
    const keywordIntensity = getKeywordIntensity(compositeText);
    const eventWeight = getEventRiskWeight(marketSymbol, compositeText);
    const timeWeight = getTimeRiskWeight(item.eventAtMs);
    const weightedScore = (0.8 + keywordIntensity * 0.34 + eventWeight * 0.42) * timeWeight;

    riskScore += weightedScore;

    if (weightedScore > strongestEventScore) {
      strongestEvent = item;
      strongestEventScore = weightedScore;
    }
  }

  if (riskScore >= 1.55) {
    return {
      overallState: "risk",
      overallReason: strongestEvent
        ? `High-impact scheduled events are too close to execution. ${strongestEvent.headline} is the dominant calendar risk in the current window.`
        : "High-impact scheduled macro events are close enough to justify risk mode.",
    };
  }

  return {
    overallState: "neutral",
    overallReason:
      "Scheduled macro events exist, but they are not close enough or concentrated enough to force risk mode yet.",
  };
}

export async function fetchMarketCalendar(
  marketSymbol: string,
): Promise<MarketCalendarPayload> {
  const countries = marketCalendarCountryMap[marketSymbol];

  if (!countries?.length) {
    return {
      items: [],
      overallState: "neutral",
      overallReason:
        "No economic-calendar country mapping is configured for this market yet.",
    };
  }

  const endpoint = `${TRADING_ECONOMICS_API_BASE_URL}/calendar/country/${encodeURIComponent(
    countries.join(","),
  )}?c=guest:guest&importance=3&f=json`;

  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return {
      items: [],
      overallState: "neutral",
      overallReason: `Economic calendar is temporarily unavailable for ${marketSymbol} (status ${response.status}). Headline flow and technical structure remain active.`,
    };
  }

  const payload = (await response.json()) as TradingEconomicsCalendarRow[];
  const items = normalizeCalendarRows(marketSymbol, Array.isArray(payload) ? payload : []);
  const aggregate = aggregateCalendarConfluence(marketSymbol, items);

  return {
    items,
    overallState: aggregate.overallState,
    overallReason: aggregate.overallReason,
  };
}
