import type { ConfluenceState } from "./arena-types";

export type NewsItem = {
  headline: string;
  sourceLabel: string;
  publishedAtLabel: string;
  note: string;
  state: ConfluenceState;
  url: string;
  publishedAtMs: number | null;
};

export type MarketNewsPayload = {
  items: NewsItem[];
  overallState: ConfluenceState;
  overallReason: string;
};

const GOOGLE_NEWS_RSS_BASE_URL = "https://news.google.com/rss/search";

const marketNewsQueryMap: Record<string, string> = {
  "XAU/USD": '"gold" OR "XAU/USD" OR bullion OR "weaker dollar" OR fed OR treasury',
  "XAG/USD": '"silver" OR "XAG/USD" OR bullion OR "weaker dollar" OR industrial metals',
  "EUR/USD": '"EUR/USD" OR euro OR ecb OR fed OR "us dollar" OR "dollar index"',
};

const riskKeywords = [
  "cpi",
  "inflation",
  "nfp",
  "payroll",
  "powell",
  "ecb",
  "fomc",
  "fed",
  "rate",
  "rates",
  "tariff",
  "war",
  "sanction",
  "speech",
  "jobs report",
  "pmi",
  "gdp",
];

const supportiveKeywordsByMarket: Record<string, string[]> = {
  "XAU/USD": [
    "gold rises",
    "gold gains",
    "safe haven",
    "weaker dollar",
    "treasury yields fall",
    "bullion demand",
  ],
  "XAG/USD": [
    "silver rises",
    "silver gains",
    "weaker dollar",
    "bullion demand",
    "industrial demand",
  ],
  "EUR/USD": [
    "euro rises",
    "euro gains",
    "dollar slips",
    "weaker dollar",
    "hawkish ecb",
  ],
};

const sourceWeights: Record<string, number> = {
  Reuters: 1.35,
  Bloomberg: 1.35,
  "Wall Street Journal": 1.3,
  CNBC: 1.2,
  MarketWatch: 1.1,
  "Investing.com": 1.05,
  FXStreet: 1.05,
  Kitco: 1.05,
  "Google News": 1,
};

function decodeHtmlEntities(value: string) {
  return value
    .replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtml(value: string) {
  return decodeHtmlEntities(value).replace(/<[^>]+>/g, "").trim();
}

function extractTagValue(block: string, tagName: string) {
  const match = block.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? stripHtml(match[1]) : "";
}

function toRelativePublishedLabel(dateString: string) {
  const timestamp = Date.parse(dateString);
  if (Number.isNaN(timestamp)) return "Unknown";

  const deltaSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (deltaSeconds < 3600) return `${Math.max(1, Math.floor(deltaSeconds / 60))}m ago`;
  if (deltaSeconds < 86400) return `${Math.floor(deltaSeconds / 3600)}h ago`;
  return `${Math.floor(deltaSeconds / 86400)}d ago`;
}

function toPublishedAtMs(dateString: string) {
  const timestamp = Date.parse(dateString);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function inferNewsState(marketSymbol: string, text: string): ConfluenceState {
  const normalized = text.toLowerCase();

  if (riskKeywords.some((keyword) => normalized.includes(keyword))) {
    return "risk";
  }

  if (
    supportiveKeywordsByMarket[marketSymbol]?.some((keyword) =>
      normalized.includes(keyword),
    )
  ) {
    return "supportive";
  }

  return "neutral";
}

function getRiskKeywordHits(text: string) {
  const normalized = text.toLowerCase();
  return riskKeywords.filter((keyword) => normalized.includes(keyword)).length;
}

function getSupportiveKeywordHits(marketSymbol: string, text: string) {
  const normalized = text.toLowerCase();
  return (
    supportiveKeywordsByMarket[marketSymbol]?.filter((keyword) =>
      normalized.includes(keyword),
    ).length ?? 0
  );
}

function getRecencyWeight(publishedAtMs: number | null) {
  if (!publishedAtMs) return 0.9;
  const ageHours = Math.max(0, (Date.now() - publishedAtMs) / (1000 * 60 * 60));
  if (ageHours <= 2) return 1.3;
  if (ageHours <= 8) return 1.15;
  if (ageHours <= 24) return 1;
  if (ageHours <= 48) return 0.85;
  return 0.7;
}

function getSourceWeight(sourceLabel: string) {
  return sourceWeights[sourceLabel] ?? 1;
}

function buildNewsNote(marketSymbol: string, state: ConfluenceState, headline: string) {
  if (state === "risk") {
    return `Headline risk is elevated for ${marketSymbol}. Treat this as a volatility warning, not direct trade direction.`;
  }

  if (state === "supportive") {
    return `Headline flow currently supports the prevailing thesis on ${marketSymbol}, but price action still controls execution.`;
  }

  return `Headline flow around ${marketSymbol} is not strong enough to override technical structure.`;
}

function parseGoogleNewsRss(xml: string, marketSymbol: string): NewsItem[] {
  const itemBlocks = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/gi))
    .map((match) => match[1])
    .slice(0, 6);

  return itemBlocks
    .map((block) => {
      const headline = extractTagValue(block, "title")
        .replace(/\s*-\s*[^-]+$/, "")
        .trim();
      const link = extractTagValue(block, "link");
      const sourceLabel = extractTagValue(block, "source") || "Google News";
      const pubDate = extractTagValue(block, "pubDate");
      const description = extractTagValue(block, "description");
      const combinedText = `${headline} ${description}`;
      const state = inferNewsState(marketSymbol, combinedText);
      const publishedAtMs = toPublishedAtMs(pubDate);

      return {
        headline,
        sourceLabel,
        publishedAtLabel: toRelativePublishedLabel(pubDate),
        note: buildNewsNote(marketSymbol, state, headline),
        state,
        url: link,
        publishedAtMs,
      };
    })
    .filter((item) => item.headline && item.url);
}

function aggregateNewsConfluence(
  marketSymbol: string,
  items: NewsItem[],
): { overallState: ConfluenceState; overallReason: string } {
  if (!items.length) {
    return {
      overallState: "neutral",
      overallReason:
        "No fresh market headlines were available for this symbol during the current scan window.",
    };
  }

  let score = 0;
  let strongestRiskSignal = 0;
  let weightedRiskHits = 0;
  let weightedSupportiveHits = 0;

  for (const item of items) {
    const text = `${item.headline} ${item.note}`;
    const recencyWeight = getRecencyWeight(item.publishedAtMs);
    const sourceWeight = getSourceWeight(item.sourceLabel);
    const riskHits = getRiskKeywordHits(text);
    const supportiveHits = getSupportiveKeywordHits(marketSymbol, text);

    const stateBase =
      item.state === "risk" ? -1.15 : item.state === "supportive" ? 0.8 : 0;
    const keywordAdjustment = supportiveHits * 0.16 - riskHits * 0.22;
    const weightedScore = (stateBase + keywordAdjustment) * sourceWeight * recencyWeight;

    score += weightedScore;
    weightedRiskHits += riskHits * sourceWeight * recencyWeight;
    weightedSupportiveHits += supportiveHits * sourceWeight * recencyWeight;
    strongestRiskSignal = Math.max(
      strongestRiskSignal,
      riskHits * sourceWeight * recencyWeight,
    );
  }

  if (strongestRiskSignal >= 2.2 || score <= -1.4) {
    return {
      overallState: "risk",
      overallReason:
        weightedRiskHits > weightedSupportiveHits
          ? "Recent headlines are dominated by macro-event and volatility keywords, so the symbol is treated as headline risk."
          : "High-impact macro references in the latest feed are strong enough to keep this symbol in risk mode.",
    };
  }

  if (score >= 1.1) {
    return {
      overallState: "supportive",
      overallReason:
        "Recent headline flow leans in favor of the prevailing thesis and no stronger macro-risk signal is dominating the feed.",
    };
  }

  return {
    overallState: "neutral",
    overallReason:
      "Headline flow is mixed or weak, so technical structure remains the primary decision driver for this symbol.",
  };
}

export async function fetchMarketNews(
  marketSymbol: string,
): Promise<MarketNewsPayload> {
  const query = marketNewsQueryMap[marketSymbol];
  if (!query) {
    return {
      items: [],
      overallState: "neutral",
      overallReason: "No market-specific news query is configured for this symbol.",
    };
  }

  const params = new URLSearchParams({
    q: query,
    hl: "en-US",
    gl: "US",
    ceid: "US:en",
  });

  try {
    const response = await fetch(
      `${GOOGLE_NEWS_RSS_BASE_URL}?${params.toString()}`,
      {
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return {
        items: [],
        overallState: "neutral",
        overallReason: "News fetch failed for this symbol, so confluence remains neutral.",
      };
    }

    const xml = await response.text();
    const items = parseGoogleNewsRss(xml, marketSymbol);
    const aggregate = aggregateNewsConfluence(marketSymbol, items);
    return {
      items,
      overallState: aggregate.overallState,
      overallReason: aggregate.overallReason,
    };
  } catch {
    return {
      items: [],
      overallState: "neutral",
      overallReason: "News fetch failed for this symbol, so confluence remains neutral.",
    };
  }
}
