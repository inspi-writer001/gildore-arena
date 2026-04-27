import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { SwingPointsForBrowser } from "./browser-session-runtime";

export type ChartVisionDecision = {
  regime: "bullish" | "bearish" | "mixed";
  verdict: "valid" | "staged" | "invalid" | "reject";
  direction: "long" | "short" | "none";
  confidence: number; // 0–1
  correctedT1?: { price: number; note: string };
  correctedT2?: { price: number; note: string };
  correctedZone?: { low: number; high: number; projectedPrice: number };
  rationale: string;
  issues: string[];
};

// Strategy doctrine is sent once and cached by Anthropic's prompt cache.
// This text is intentionally stable — do not inline dynamic values here.
const STRATEGY_SYSTEM_PROMPT = `You are a disciplined technical analysis agent specialising in the Third Touch Trendline strategy. You will be shown a sequence of candlestick chart screenshots taken at different zoom levels of the same market. Your job is to visually evaluate whether a valid third-touch trendline setup exists.

## Strategy Rules

### Regime detection (do this first)
- Classify recent structure as: bullish, bearish, or mixed.
- Bullish regime: higher lows, close drift upward → look for ascending support lines, long setups only.
- Bearish regime: lower highs, close drift downward → look for descending resistance lines, short setups only.
- Mixed regime: conflicted or range-bound → return regime=mixed, verdict=reject, no setup.
- NEVER draw a rising support line in a falling market or a falling resistance line in a rising market.

### Swing identification
- A valid swing uses a WIDE neighbourhood — roughly 10 candles left and right.
- Ignore micro zig-zags and local noise.
- Anchor to MAJOR visible turning points that any trader would notice.

### Trendline construction
- T1 = first major structural swing (low for bullish, high for bearish).
- T2 = second swing confirming slope (higher low for bullish, lower high for bearish).
- The line through T1→T2 is projected forward.
- Prefer lines that the market has visibly respected multiple times.

### T2 rollover rule
- If price closed aggressively through the original T2 before touching T3, the FIRST candle body that violated the line becomes the new T2.
- Use body price for T2: min(open,close) for bearish, max(open,close) for bullish.

### Third touch zone
- The projected T3 interaction is a ZONE, not a single price.
- Score candidates by proximity to the line, clean reaction, body on the correct side.
- A wick penetration with body respecting the line is a valid touch.
- A candle body closing aggressively through the line is invalidation.

### Candlestick confirmation required
- Bullish: hammer, bullish engulfing, doji at support, tweezer bottom.
- Bearish: shooting star, bearish engulfing, doji at resistance, tweezer top.
- Without confirmation: keep verdict=staged, do NOT enter.

### Risk / reward
- Minimum 1:3 required.
- If obvious opposing structure blocks the reward path, verdict=staged.

## Output format
Respond ONLY with a valid JSON object matching this exact schema. No markdown fences, no explanation outside the JSON:

{
  "regime": "bullish" | "bearish" | "mixed",
  "verdict": "valid" | "staged" | "invalid" | "reject",
  "direction": "long" | "short" | "none",
  "confidence": <number 0 to 1>,
  "correctedT1": { "price": <number>, "note": "<why you moved it or kept it>" } | null,
  "correctedT2": { "price": <number>, "note": "<why you moved it or kept it>" } | null,
  "correctedZone": { "low": <number>, "high": <number>, "projectedPrice": <number> } | null,
  "rationale": "<one paragraph explaining your visual read>",
  "issues": ["<issue 1>", "<issue 2>"]
}`;

function buildUserPrompt(candidate: SwingPointsForBrowser | undefined, screenshotCount: number): string {
  const candidateSection = candidate
    ? `The deterministic engine produced this candidate for context:
- Direction: ${candidate.direction}
- T1 price: ${candidate.t1Price}
- T2 price: ${candidate.t2Price}
- Projected price at T3: ${candidate.projectedPrice}
- T3 zone: ${candidate.zoneLow} – ${candidate.zoneHigh}

Use these as a starting hypothesis — correct them if the visual evidence disagrees.`
    : `No deterministic candidate is available for this chart. Identify the structure purely from visual analysis.`;

  return `You are reviewing ${screenshotCount} sequential chart screenshots taken at increasing zoom levels of the same market. The screenshots are ordered from widest historical view to most recent price action.

${candidateSection}

Your task:
1. Establish the market regime from the wide view — bullish, bearish, or mixed.
2. Identify T1 — the first dominant structural swing (low for bullish, high for bearish).
3. Identify T2 — the second swing confirming slope.
4. Assess the T3 zone — is price currently near the projected line?
5. Return your verdict: valid, staged, invalid, or reject.

Be honest. If the chart is ambiguous, say so in rationale and lower confidence.`;
}

export async function analyzeChartWithVision(
  screenshots: Buffer[],
  candidate?: SwingPointsForBrowser,
): Promise<ChartVisionDecision> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured.");

  const client = new Anthropic({ apiKey });

  const imageContent: Anthropic.ImageBlockParam[] = screenshots.map((buf, index) => ({
    type: "image",
    source: {
      type: "base64",
      media_type: "image/png",
      data: buf.toString("base64"),
    },
    // Label each screenshot so Claude can reference them
  } satisfies Anthropic.ImageBlockParam));

  // Interleave screenshot labels with images so Claude can reference them by position
  const contentBlocks: Anthropic.ContentBlockParam[] = [];
  const labels = [
    "Screenshot 1 of 6 — Wide historical context (~200 candles). Use this to establish regime.",
    "Screenshot 2 of 6 — T1 anchor region. Is this swing structurally dominant?",
    "Screenshot 3 of 6 — T1→T2 span. Does this trendline slope look credible?",
    "Screenshot 4 of 6 — Post-T2 behaviour. Has price respected the projected line?",
    "Screenshot 5 of 6 — T3 zone close-up. Is price currently interacting with the projected line?",
    "Screenshot 6 of 6 — Current settled view. Full trendline visible. Assess overall structure.",
  ];

  for (let i = 0; i < screenshots.length; i++) {
    contentBlocks.push({
      type: "text",
      text: labels[i] ?? `Screenshot ${i + 1} of ${screenshots.length}`,
    });
    contentBlocks.push(imageContent[i]);
  }

  contentBlocks.push({
    type: "text",
    text: buildUserPrompt(candidate, screenshots.length),
  });

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: STRATEGY_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: contentBlocks }],
  });

  const fullText = response.content.find((b) => b.type === "text")?.text ?? "";

  console.log("[vision-agent] raw response:\n", fullText);
  console.log("[vision-agent] usage:", JSON.stringify(response.usage));

  // Extract the outermost JSON object in case Claude added trailing text.
  const jsonMatch = fullText.match(/\{[\s\S]*\}/);
  const jsonText = jsonMatch?.[0] ?? fullText;

  try {
    const raw = JSON.parse(jsonText) as Partial<ChartVisionDecision>;
    return {
      regime: raw.regime ?? "mixed",
      verdict: raw.verdict ?? "reject",
      direction: raw.direction ?? "none",
      confidence: typeof raw.confidence === "number" ? Math.max(0, Math.min(1, raw.confidence)) : 0.5,
      correctedT1: raw.correctedT1 ?? undefined,
      correctedT2: raw.correctedT2 ?? undefined,
      correctedZone: raw.correctedZone ?? undefined,
      rationale: raw.rationale ?? "No rationale returned.",
      issues: Array.isArray(raw.issues) ? raw.issues : [],
    };
  } catch {
    return {
      regime: "mixed",
      verdict: "reject",
      direction: "none",
      confidence: 0,
      rationale: `Vision analysis returned unparseable response: ${jsonText.slice(0, 200)}`,
      issues: ["JSON parse failed"],
    };
  }
}
