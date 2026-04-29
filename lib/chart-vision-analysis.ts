import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { SwingPointsForBrowser } from "./browser-session-runtime";

// Pixel position within the 1440×900 final-view screenshot (View 6).
// xPct=0 is left edge, xPct=1 is right edge. yPct=0 is top, yPct=1 is bottom.
// These coordinates are used directly as page.mouse.click(x, y) targets.
export type ScreenPos = { xPct: number; yPct: number };

export type ChartVisionDecision = {
  regime: "bullish" | "bearish" | "mixed";
  verdict: "valid" | "staged" | "invalid" | "reject";
  direction: "long" | "short" | "none";
  structureStatus: "clean" | "weak" | "broken" | "none";
  confidence: number; // 0–1
  // date: ISO "YYYY-MM-DD" (UTC) — used directly as Unix timestamp for drawing
  // when the anchor is off-screen in View 6 and viewSixPos cannot be reported.
  correctedT1?: { price: number; note: string; date?: string; viewSixPos?: ScreenPos };
  correctedT2?: { price: number; note: string; date?: string; viewSixPos?: ScreenPos };
  correctedZone?: { low: number; high: number; projectedPrice: number };
  invalidationZone?: { low: number; high: number; note: string };
  invalidationNote?: string;
  rationale: string;
  issues: string[];
};

// Strategy doctrine is sent once and cached by Anthropic's prompt cache.
// This text is intentionally stable — do not inline dynamic values here.
const STRATEGY_SYSTEM_PROMPT = `You are a disciplined technical analysis agent specialising in the Third Touch Trendline strategy. You will be shown a sequence of candlestick chart images taken at different zoom levels of the same market. Your job is to visually evaluate whether a valid third-touch trendline setup exists.

## Strategy Rules

### Regime detection (do this first)
- Classify recent structure as: bullish, bearish, or mixed.
- Bullish regime: higher lows, close drift upward → look for ascending support lines, long setups only.
- Bearish regime: lower highs, close drift downward → look for descending resistance lines, short setups only.
- Mixed regime: conflicted or range-bound → return regime=mixed, verdict=reject for the trade decision.
- NEVER draw a rising support line in a falling market or a falling resistance line in a rising market.

### Structure mapping is separate from trade decision
- Your \`verdict\` is the trade decision only.
- Even when verdict is \`reject\` or \`invalid\`, you should still map the most dominant visible structure if one can be inferred.
- If the best visible structure is broken, still return the failed \`T1\`, \`T2\`, projected line/zone, and an invalidation region when possible.
- Only return \`structureStatus="none"\` and null anchors/zones when there is truly no drawable structure at all.

### Brevity and output discipline
- Keep every note short and direct.
- \`correctedT1.note\`, \`correctedT2.note\`, and \`invalidationNote\` should usually be one short sentence.
- \`rationale\` should be one short paragraph, ideally 3-5 sentences.
- \`issues\` should contain at most 3 short items.
- Do NOT mention "Screenshot 1", "Screenshot 2", or similar wording. Refer to the chart naturally, e.g. "From what I can see..."
- Prioritise returning complete valid JSON over extra explanation.
- If token budget is getting tight, shorten rationale and issues first. Never leave the JSON unfinished.

### Multi-timeframe discovery flow
The screenshots follow a deliberate multi-timeframe sequence:
- Views 1–2 are the 8h timeframe. Use these to find the OLDEST available structural swing — the origin of the entire trend visible in the trading timeframe. This is the true T1 candidate.
- Views 3–6 are the trading timeframe (4h or similar), zoomed out to show the full structure from that oldest swing to current price.

### Swing identification
- T1 MUST be the OLDEST, MOST DOMINANT structural swing visible across the full history shown in Views 1–2. It is the absolute deepest trough (bullish) or highest peak (bearish) that originated the CURRENT macro trend — not any correction within it.
- **Critical trap to avoid**: Do NOT pick a local low that formed DURING an already-established rally as T1. If the chart shows a multi-week or multi-month uptrend already in progress, T1 is the trough that STARTED that uptrend — it will be WEEKS OR MONTHS before the first impulse. A correction low within the uptrend is NOT T1.
- T2 is the FIRST significant higher low (bullish) or lower high (bearish) after T1. NOT the second or third. The EARLIEST swing that confirms the slope direction.
- T2 is typically 10–30+ days after T1 in time. A T2 that is only 2–5 days after T1 almost always produces a slope too steep to be meaningful — if that happens, look for a later higher low as T2.
- **Slope sanity check — mandatory**: After identifying T1 and T2, mentally project the line forward to current price. If the projected line at current date is MORE THAN 5% ABOVE current price, the slope is too steep — T2 is wrong. Either go further back for T1 or pick a later, shallower T2.
- Use a WIDE neighbourhood — at least 20 candles either side when assessing on the trading timeframe.
- Ignore all micro zig-zags. Anchor only to turns that dominate the full zoomed-out view.

### Trendline construction
- T1 = oldest dominant structural swing from the 8h context (low for bullish, high for bearish).
- T2 = FIRST significant confirming swing after T1 on the trading timeframe (first higher low / first lower high).
- The line through T1→T2 is projected forward. A shallower slope from an earlier/later T2 is ALWAYS preferable over a steep slope. The line should arrive at or near current price at current time — if it is well above or below, reconsider the anchors.
- Prefer the line that the market has most clearly respected across the longest visible span.

### T2 rollover rule
- If price closed aggressively through the original T2 before touching T3, the FIRST candle body that violated the line becomes the new T2.
- Use body price for T2: min(open,close) for bearish, max(open,close) for bullish.

### Third touch zone and invalidation
- The projected T3 interaction is a ZONE, not a single price.
- Score candidates by proximity to the line, clean reaction, body on the correct side.
- A wick penetration with body respecting the line is a valid touch.
- A candle body closing aggressively through the line is invalidation.
- When invalidation happened, return \`structureStatus="broken"\` and provide an \`invalidationZone\` plus \`invalidationNote\`.

### Candlestick confirmation required
- Bullish: hammer, bullish engulfing, doji at support, tweezer bottom.
- Bearish: shooting star, bearish engulfing, doji at resistance, tweezer top.
- Without confirmation: keep verdict=staged, do NOT enter.

### Risk / reward
- Minimum 1:3 required.
- If obvious opposing structure blocks the reward path, verdict=staged.

## Screen position reporting (View 6 only)
The final image (View 6) is the drawing canvas. For each anchor you identify, report its pixel position in that image as viewSixPos:
- xPct: horizontal position as a fraction of image width — 0.0 = left edge, 1.0 = right edge
- yPct: vertical position as a fraction of image height — 0.0 = top, 1.0 = bottom
- The chart toolbar occupies roughly x < 0.11 and the price axis roughly x > 0.93
- Locate the EXACT candle body/wick tip of T1 and T2 in View 6 — these coordinates are used directly as mouse click targets for drawing
- **If T1 is not visible in View 6 (off-screen left)**: set viewSixPos to null. CRITICAL: do NOT substitute T1's position with the leftmost visible candle in View 6 — that is a different, higher swing. The price in correctedT1.price must still be the TRUE T1 price identified from the 8h views, NOT the price of the leftmost visible candle.
- If T2 is not visible in View 6: set viewSixPos to null for T2 as well.
- **Always output "date" for both T1 and T2** — read the approximate date from the chart's time-axis labels in the view where you first identified that anchor (Views 1–4). Format: "YYYY-MM-DD". This is used as a fallback timestamp for drawing when viewSixPos is unavailable. Best-guess is fine (±2 days is acceptable).

## Output format
Respond ONLY with a valid JSON object matching this exact schema. No markdown fences, no explanation outside the JSON:

{
  "regime": "bullish" | "bearish" | "mixed",
  "verdict": "valid" | "staged" | "invalid" | "reject",
  "direction": "long" | "short" | "none",
  "structureStatus": "clean" | "weak" | "broken" | "none",
  "confidence": <number 0 to 1>,
  "correctedT1": { "price": <number>, "note": "<why>", "date": "<YYYY-MM-DD>", "viewSixPos": { "xPct": <0-1>, "yPct": <0-1> } } | null,
  "correctedT2": { "price": <number>, "note": "<why>", "date": "<YYYY-MM-DD>", "viewSixPos": { "xPct": <0-1>, "yPct": <0-1> } } | null,
  "correctedZone": { "low": <number>, "high": <number>, "projectedPrice": <number> } | null,
  "invalidationZone": { "low": <number>, "high": <number>, "note": "<where structure broke>" } | null,
  "invalidationNote": "<very short explanation>" | null,
  "rationale": "<short paragraph>",
  "issues": ["<short issue 1>", "<short issue 2>"]
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

  return `You are reviewing ${screenshotCount} sequential chart screenshots following a deliberate multi-timeframe discovery flow. Views 1–2 are the 8h timeframe showing the full available history. Views 3–6 are the trading timeframe (4h or similar) at decreasing zoom, ending at the drawing canvas.

${candidateSection}

Your task:
1. From Views 1–2 (8h): establish the dominant regime and locate the OLDEST, MOST DOMINANT structural swing. This is T1 — the absolute deepest trough (bullish) or highest peak (bearish) visible. It may be months before recent price. NOT a local swing within an ongoing trend.
2. From Views 3–4 (trading TF zoomed out): confirm T1. Then identify T2 — the first significant higher low (bullish) or lower high (bearish) that sets the slope. T2 is typically 10–30+ days after T1. If T2 is only a few days from T1, the slope will be too steep — pick a later T2.
3. **Slope sanity check**: Project the T1→T2 line to the rightmost candle visible. The projected price should be near or below current price for a bullish setup (price approaching support from above). If the projected line at current time is well ABOVE current price, stop — your T2 is wrong. Adjust until the line arrives near current price.
4. From Views 5–6: Assess the T3 zone — is current price approaching or touching the projected line?
5. Return your verdict: valid, staged, invalid, or reject.
6. Even if verdict is reject, still map the dominant structure when visible.
7. In View 6 (DRAWING CANVAS), locate T1 and T2 at the EXACT candle wick/body tip and report viewSixPos (xPct, yPct as fractions of the 1440×900 image). Both T1 and T2 must be visible in View 6 — if T1 is off-screen left, use its earliest visible candle.

Be honest. Lower confidence if ambiguous, but always attempt to map the dominant structure.`;
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
    "View 1 of 6 — 8H TIMEFRAME, broad regime view. Establish the dominant trend direction across the full visible history.",
    "View 2 of 6 — 8H TIMEFRAME, panned to the OLDEST AVAILABLE DATA. Find the single most dominant structural swing here — this is the true T1 origin (deepest trough for bullish, highest peak for bearish). This is the anchor of everything.",
    "View 3 of 6 — TRADING TIMEFRAME, maximum zoom-out. The full structure from the oldest dominant swing to current price is visible. T1 should be somewhere on the left side.",
    "View 4 of 6 — TRADING TIMEFRAME, T1 region centred. Confirm T1: the oldest, most dominant swing. This is NOT a recent local extreme — it is the origin swing visible in the 8h views.",
    "View 5 of 6 — TRADING TIMEFRAME, T1→T2 slope and post-T2 line interaction. Confirm T2 and assess how price has respected the projected line.",
    "View 6 of 6 — TRADING TIMEFRAME, DRAWING CANVAS. T1 is on the left, T2 in the middle, current price (T3 zone) on the right. Report viewSixPos for BOTH T1 and T2 from THIS image — these coordinates are used directly for drawing.",
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
    text: `${buildUserPrompt(candidate, screenshots.length)}

Important output rules:
- Never mention screenshot numbers in the JSON.
- Keep notes concise.
- Finish the JSON fully even if you must shorten rationale and issues.`,
  });

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1400,
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

    const parseScreenPos = (pos: unknown): ScreenPos | undefined => {
      if (!pos || typeof pos !== "object") return undefined;
      const p = pos as Record<string, unknown>;
      const x = typeof p.xPct === "number" ? p.xPct : undefined;
      const y = typeof p.yPct === "number" ? p.yPct : undefined;
      if (x === undefined || y === undefined) return undefined;
      // Clamp to valid range
      return { xPct: Math.max(0, Math.min(1, x)), yPct: Math.max(0, Math.min(1, y)) };
    };

    const parseAnchor = (
      anchor: unknown,
    ): { price: number; note: string; date?: string; viewSixPos?: ScreenPos } | undefined => {
      if (!anchor || typeof anchor !== "object") return undefined;
      const a = anchor as Record<string, unknown>;
      const price = typeof a.price === "number" ? a.price : undefined;
      if (!price) return undefined;
      // Validate ISO date format "YYYY-MM-DD"
      const rawDate = typeof a.date === "string" ? a.date : undefined;
      const date = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : undefined;
      return {
        price,
        note: typeof a.note === "string" ? a.note : "",
        date,
        viewSixPos: parseScreenPos(a.viewSixPos),
      };
    };

    return {
      regime: raw.regime ?? "mixed",
      verdict: raw.verdict ?? "reject",
      direction: raw.direction ?? "none",
      structureStatus: raw.structureStatus ?? "none",
      confidence: typeof raw.confidence === "number" ? Math.max(0, Math.min(1, raw.confidence)) : 0.5,
      correctedT1: parseAnchor(raw.correctedT1),
      correctedT2: parseAnchor(raw.correctedT2),
      correctedZone: raw.correctedZone ?? undefined,
      invalidationZone: raw.invalidationZone ?? undefined,
      invalidationNote: raw.invalidationNote ?? undefined,
      rationale: raw.rationale ?? "No rationale returned.",
      issues: Array.isArray(raw.issues) ? raw.issues : [],
    };
  } catch {
    return {
      regime: "mixed",
      verdict: "reject",
      direction: "none",
      structureStatus: "none",
      confidence: 0,
      invalidationNote: "Vision analysis response could not be parsed.",
      rationale: `Vision analysis returned unparseable response: ${jsonText.slice(0, 200)}`,
      issues: ["JSON parse failed"],
    };
  }
}
