import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { SwingPointsForBrowser, ThirdTouchT2Candidate } from "./browser-session-runtime";

// Pixel position within the 1440×900 final-view screenshot (View 6).
// xPct=0 is left edge, xPct=1 is right edge. yPct=0 is top, yPct=1 is bottom.
// These coordinates are used directly as page.mouse.click(x, y) targets.
export type ScreenPos = { xPct: number; yPct: number };

// Result of a lightweight post-draw verification pass.
export type DrawingVerification = {
  assessment: "correct" | "slope_too_steep" | "slope_too_shallow" | "line_broken";
  note: string;
  // Corrected anchors to redraw with, when assessment !== "correct"
  correctedT1?: { price: number; date: string; viewPos?: ScreenPos };
  correctedT2?: { price: number; date: string; viewPos?: ScreenPos };
};

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
- Views 1–2 are the 8h timeframe showing the CURRENT STRUCTURAL CYCLE (~4 months). Use these to identify the dominant regime and locate the trough (bullish) or peak (bearish) that LAUNCHED the active trend currently visible in the 4h trading timeframe. This is the true T1.
- Views 3–6 are the trading timeframe (4h or similar), zoomed out to show the full structure from T1 to current price.

### Swing identification
- **T1 = the structural origin of the CURRENT ACTIVE TREND visible in Views 3–6.** For a bullish setup, it is the lowest trough that you can draw a line FROM and reach current price action going upward. It is NOT the absolute all-time historical low — it is the trough that *started this specific rally*.
- **Ancient lows from a different cycle are irrelevant.** If the 8h view shows a very deep trough from many months or years ago that belongs to a completely different market cycle, ignore it. T1 must be a pivot you can project forward and logically connect to current price.
- **How to identify T1**: Look at Views 3–6 (the trading timeframe). There is a clear rally in progress. Find the lowest point BEFORE that rally began — the trough the market bounced off to start the entire move visible in the trading timeframe chart. That is T1.
- **Critical trap**: Do NOT pick a higher local low that formed mid-rally as T1. The trough that started the rally is LOWER than any subsequent correction low. If your T1 is not the lowest point visible before the rally, you have the wrong candle.
- T2 is the FIRST significant higher low (bullish) or lower high (bearish) after T1 — the earliest swing that confirms the slope direction.
- T2 is typically 10–30+ days after T1 in time. A T2 only 2–5 days from T1 produces a slope too steep to be meaningful.
- **Slope sanity check — mandatory**: Project the T1→T2 line forward to current price. If it lands MORE THAN 5% ABOVE current price, the slope is too steep — pick a later T2 or re-examine T1.
- Use a WIDE neighbourhood — at least 20 candles either side when assessing on the trading timeframe.
- Ignore all micro zig-zags. Anchor only to turns that dominate the full zoomed-out view.

### Trendline construction
- T1 = the trough (bullish) or peak (bearish) that originated the current active trend — identifiable in the 8h views.
- T2 = FIRST significant confirming swing after T1 on the trading timeframe (first higher low / first lower high).
- The line through T1→T2 is projected forward. A shallower slope is ALWAYS preferable. The projected line should arrive near or below current price for a bullish setup (price is touching or approaching support from above).
- Prefer the line that the market has most clearly respected across the longest visible span.

### CRITICAL: Anchor at wick extremes — never at body prices
The price you report for T1 and T2 MUST be the candle WICK extreme, not the body:
- **Bullish ascending support**: T1 price = the LOW (L) of the T1 candle (the bottom wick tip). T2 price = the LOW (L) of the T2 candle. The drawn line must run **BELOW all candle bodies** from T1 through to current price. If the line would cut through any candle body, the T2 anchor is wrong — choose a later swing whose wick low produces a line that stays under all bodies.
- **Bearish descending resistance**: T1 price = the HIGH (H) of the T1 candle. T2 price = the HIGH (H) of the T2 candle. The drawn line must run **ABOVE all candle bodies**.
- A line that cuts through candle bodies is NOT a valid trendline, regardless of how clean the T1/T2 swing points look in isolation.
- Wick penetration (line touched by a wick only, body stays on the correct side) is fine — that is normal price behaviour at support/resistance.

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

  return `You are reviewing ${screenshotCount} sequential chart screenshots following a deliberate multi-timeframe discovery flow. Views 1–2 are the 8h timeframe showing the CURRENT STRUCTURAL CYCLE (~4 months). Views 3–6 are the trading timeframe (4h or similar) at decreasing zoom, ending at the drawing canvas.

${candidateSection}

Your task:
1. From Views 1–2 (8h): establish the dominant regime. Identify the trough (bullish) or peak (bearish) that STARTED the current multi-week rally visible in the chart. This is T1. Ask yourself: "Before this rally began, where was the lowest point?" — that is T1. Ignore ancient historical lows from completely different market cycles that are not connected to the current move.
2. From Views 3–4 (trading TF zoomed out): confirm T1 is the lowest point BEFORE the rally — not a correction low mid-rally. Then identify T2 — the first significant higher low that sets the slope. T2 is typically 10–30+ days after T1.
3. **Slope sanity check**: Project the T1→T2 line to the rightmost visible candle. For a bullish setup, the projected line should be at or below current price — price is above support or touching it. If the line is well ABOVE current price, your T2 is wrong (line is too steep). Adjust until the projection makes contact sense with current price.
4. From Views 5–6: Assess the T3 zone — is current price approaching or touching the projected line?
5. Return your verdict: valid, staged, invalid, or reject.
6. Even if verdict is reject, still map the dominant structure when visible.
7. In View 6 (DRAWING CANVAS), report viewSixPos for T1 and T2 if visible. If T1 is off-screen, set viewSixPos to null — use the correct price and date from the 8h analysis, not a substitute candle.

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
    "View 1 of 6 — 8H TIMEFRAME, current structural cycle (~4 months). Identify the dominant regime. Note the major trough that launched the current multi-week rally — this is the candidate T1 origin.",
    "View 2 of 6 — 8H TIMEFRAME, shifted slightly left so the CURRENT TREND ORIGIN is near the left edge. The trough that STARTED this specific rally (not an ancient historical low from a different cycle) should be prominent on the left. Confirm T1: it is the lowest visible point BEFORE the rally began, from which the market bounced and never looked back.",
    "View 3 of 6 — TRADING TIMEFRAME, maximum zoom-out. T1 (the rally's origin trough) should be visible on the left. The full move from T1 to current price is visible.",
    "View 4 of 6 — TRADING TIMEFRAME, T1 region centred. Confirm T1 is the lowest point before the rally — not a correction low mid-rally. T2 (first significant higher low) is visible to the right.",
    "View 5 of 6 — TRADING TIMEFRAME, T1→T2 slope and post-T2 price behaviour. Confirm T2 and assess how price has respected the projected ascending line.",
    "View 6 of 6 — TRADING TIMEFRAME, DRAWING CANVAS. T1 on the left, T2 in the middle, current price (T3 zone) on the right. Report viewSixPos for T1 and T2 from THIS image only — used directly for drawing.",
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

// Sonnet-based final confirmation. Runs AFTER all drawing and verification passes
// to give a high-quality structural assessment of the final chart state. Checks:
//   1. Anchors are at wick lows (ascending) / wick highs (descending)
//   2. Line runs cleanly below (ascending) / above (descending) all candle bodies
//   3. T1 is the structural origin trough, NOT a correction low mid-rally
// Returns suggested T1/T2 dates if the structure is wrong.
export type SonnetConfirmation = {
  confirmed: boolean;
  note: string;
  t1Correct: boolean;
  t2Correct: boolean;
  suggestedT1Date?: string;
  suggestedT1Price?: number;
  selectedT2CandidateId?: string;
};

export async function confirmStructureWithSonnet(
  screenshot: Buffer,
  t1: { price: number; date?: string },
  t2: { price: number; date?: string },
  t2Candidates: ThirdTouchT2Candidate[],
): Promise<SonnetConfirmation> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { confirmed: false, note: "ANTHROPIC_API_KEY missing", t1Correct: false, t2Correct: false };

  const client = new Anthropic({ apiKey });

  const candidateList = t2Candidates.length > 0
    ? t2Candidates
        .map((candidate) =>
          `- ${candidate.id}: ${new Date(candidate.timeSec * 1000).toISOString()} @ ${candidate.price} (${candidate.note})`,
        )
        .join("\n")
    : "- C0: keep the current T2";

  const prompt = `This is the current chart with a blue ascending trendline drawn.

Current anchors:
- T1: ~${t1.date ?? "unknown"}, price ~${t1.price}
- T2: ~${t2.date ?? "unknown"}, price ~${t2.price}

Exact T2 candidates from market data:
${candidateList}

## What to verify:

**T1 — structural origin trough:**
- Must be the lowest wick of the CURRENT CYCLE shown in this chart view — the trough the present multi-week rally launched from
- IMPORTANT: Do NOT chase lows that are far to the left and belong to a DIFFERENT prior market cycle. The chart intentionally shows 90 days of history. T1 should be within this window, not at its far edge.
- If the drawn T1 is clearly too late (a higher correction low mid-rally), suggest the correct earlier date. But if T1 is already near the leftmost significant trough of the visible rally, it is likely correct.

**T2 — first significant higher low:**
- Must be the FIRST clear higher low after T1 — a candle or cluster where price bounced and THEN rallied strongly
- T2 wick low should be CLEARLY HIGHER than T1 wick low (at least 100+ pts above T1 for this chart)
- T2 should be at least 10 days after T1 (closer than 8 days = likely wrong)
- T2 is the inflection point: before T2 price was still correcting, after T2 the rally accelerated
- NOT a random slightly-higher candle mid-correction — it must be a CLEAN BOUNCE POINT
- Choose T2 from the exact candidate list above. Do NOT invent a new T2 date outside that list unless every candidate is invalid.
- If the current T2 is already correct, return "selectedT2CandidateId": "KEEP_CURRENT".
- If a different candidate is better, return its candidate id exactly as listed, like "C2".

**Line quality:**
- Line must run BELOW ALL candle bodies between T1 and current price
- Wick touches are fine; body cuts are not

Return confirmed=true ONLY if all three criteria are met. Otherwise return corrected dates/prices.

JSON only:
{
  "confirmed": true | false,
  "note": "<one sentence>",
  "t1Correct": true | false,
  "t2Correct": true | false,
  "suggestedT1Date": "<YYYY-MM-DD>" | null,
  "suggestedT1Price": <wick low price number> | null,
  "selectedT2CandidateId": "KEEP_CURRENT" | "<candidate id>" | null
}`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: screenshot.toString("base64") } },
          { type: "text", text: prompt },
        ],
      }],
    });

    const text = response.content.find((b) => b.type === "text")?.text ?? "";
    console.log("[sonnet-confirm] raw:", text.trim());

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { confirmed: false, note: "parse failed", t1Correct: false, t2Correct: false };

    const raw = JSON.parse(jsonMatch[0]) as Partial<SonnetConfirmation>;
    return {
      confirmed: raw.confirmed ?? true,
      note: raw.note ?? "",
      t1Correct: raw.t1Correct ?? true,
      t2Correct: raw.t2Correct ?? true,
      suggestedT1Date: raw.suggestedT1Date ?? undefined,
      suggestedT1Price: raw.suggestedT1Price ?? undefined,
      selectedT2CandidateId:
        typeof (raw as { selectedT2CandidateId?: unknown }).selectedT2CandidateId === "string"
          ? (raw as { selectedT2CandidateId: string }).selectedT2CandidateId
          : undefined,
    };
  } catch (err) {
    console.error("[sonnet-confirm] error:", err);
    return { confirmed: false, note: "confirm call failed", t1Correct: false, t2Correct: false };
  }
}

// Lightweight post-draw verification. Uses Haiku (cheap, fast) to check whether
// the drawn trendline looks correct on the final chart screenshot. If the slope is
// wrong it returns corrected anchor suggestions so the caller can redraw once.
export async function verifyChartDrawing(
  screenshot: Buffer,
  t1: { price: number; date?: string },
  t2: { price: number; date?: string },
  zone: { low: number; high: number },
): Promise<DrawingVerification> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { assessment: "correct", note: "ANTHROPIC_API_KEY missing — skipping verify" };

  const client = new Anthropic({ apiKey });

  const prompt = `A blue ascending trendline has been drawn on this 4h candlestick chart.
Expected structure:
- T1 anchor: ~${t1.date ?? "unknown date"}, price ~${t1.price} — the WICK LOW of the structural origin trough
- T2 anchor: ~${t2.date ?? "unknown date"}, price ~${t2.price} — the WICK LOW of the first significant higher low
- Zone box (purple rectangle): should be near current price (~${zone.low}–${zone.high})

The FUNDAMENTAL RULE for a valid ascending support trendline:
- Anchors must be at candle WICK LOWS (the very bottom of the wicks, not the body)
- The line must run BELOW ALL CANDLE BODIES between T1 and the right edge
- If the line cuts through ANY candle body (not just a wick), it is INVALID

Assess the drawn blue line:
1. Does the line run cleanly BELOW all candle bodies? (correct)
2. Does the line cut through candle bodies at any point? (slope_too_steep)
3. Is price trading above the line at the current date (right side)? (correct) Or is the line above recent candles? (slope_too_steep)

If the line cuts through bodies: identify the WICK LOW of the leftmost structural trough (T1 — deepest low before the rally) and the WICK LOW of the first clear higher low (T2) that produces a line which passes cleanly BELOW all intermediate candle bodies.

Respond ONLY with valid JSON, no markdown:
{
  "assessment": "correct" | "slope_too_steep" | "slope_too_shallow" | "line_broken",
  "note": "<one short sentence>",
  "correctedT1": { "price": <wick low price>, "date": "<YYYY-MM-DD>", "xPct": <0-1>, "yPct": <0.20-0.88> } | null,
  "correctedT2": { "price": <wick low price>, "date": "<YYYY-MM-DD>", "xPct": <0-1>, "yPct": <0.20-0.88> } | null
}
Note: yPct must be between 0.20 and 0.88 (chart canvas only, not toolbar/axis areas).`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 350,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: screenshot.toString("base64") },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    });

    const text = response.content.find((b) => b.type === "text")?.text ?? "";
    console.log("[verify] raw:", text.trim());

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { assessment: "correct", note: "parse failed — treating as correct" };

    const raw = JSON.parse(jsonMatch[0]) as {
      assessment?: string;
      note?: string;
      correctedT1?: { price?: number; date?: string; xPct?: number; yPct?: number } | null;
      correctedT2?: { price?: number; date?: string; xPct?: number; yPct?: number } | null;
    };

    const parseAnchor = (a: typeof raw.correctedT1) => {
      if (!a || typeof a.price !== "number") return undefined;
      const pos = (typeof a.xPct === "number" && typeof a.yPct === "number")
        ? { xPct: Math.max(0, Math.min(1, a.xPct)), yPct: Math.max(0, Math.min(1, a.yPct)) }
        : undefined;
      return {
        price: a.price,
        date: typeof a.date === "string" ? a.date : "",
        viewPos: pos,
      };
    };

    const validAssessments = ["correct", "slope_too_steep", "slope_too_shallow", "line_broken"] as const;
    const assessment = validAssessments.includes(raw.assessment as never)
      ? (raw.assessment as DrawingVerification["assessment"])
      : "correct";

    return {
      assessment,
      note: typeof raw.note === "string" ? raw.note : "",
      correctedT1: parseAnchor(raw.correctedT1) ?? undefined,
      correctedT2: parseAnchor(raw.correctedT2) ?? undefined,
    };
  } catch (err) {
    console.error("[verify] error:", err);
    return { assessment: "correct", note: "verify call failed — treating as correct" };
  }
}

export type FibonacciVerification = {
  confirmed: boolean;
  structureIntact: boolean;
  priceInZone: boolean;
  note: string;
};

export type FibonacciPlacementEstimate = {
  confirmed: boolean;
  shouldAdjust: boolean;
  anchorCycle: "intended_latest_swing" | "older_left_swing" | "unclear";
  leftAnchorBarError: number;
  rightAnchorBarError: number;
  averageBarError: number;
  confidence: number;
  note: string;
};

export async function verifyFibonacciDrawing(
  screenshot: Buffer,
  context: {
    direction: "long" | "short";
    activeLeg: { lowPrice: number; highPrice: number };
    preferredZone?: { low: number; high: number };
  },
): Promise<FibonacciVerification> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { confirmed: true, structureIntact: true, priceInZone: false, note: "ANTHROPIC_API_KEY missing — skipping verify" };
  }

  const client = new Anthropic({ apiKey });
  const { direction, activeLeg, preferredZone } = context;
  const isBullish = direction === "long";

  const prompt = `Fibonacci retracements have been drawn on this ${isBullish ? "bullish" : "bearish"} chart.

Expected structure:
- Active fibonacci leg: from ~${activeLeg.lowPrice} (swing low) to ~${activeLeg.highPrice} (swing high)
- ${preferredZone ? `Preferred reaction zone: ~${preferredZone.low}–${preferredZone.high} (should appear as a coloured rectangle)` : "No zone rectangle expected."}
- The chart should show multiple fibonacci retracement lines (horizontal dashed lines at 0, 0.5, 0.618, 0.7, 0.786, 1 levels)

Assess what you see:
1. Are fibonacci retracement lines visible on the chart? (horizontal lines spanning the price range)
2. Is the ${isBullish ? "bullish" : "bearish"} trend structure intact (price trending ${isBullish ? "upward" : "downward"})?
3. Is current price ${isBullish ? "near or within the retracement zone (below the high, above 0.5 level)" : "near or within the retracement zone (above the low, below 0.5 level)"}?

Respond ONLY with valid JSON, no markdown:
{
  "confirmed": true | false,
  "structureIntact": true | false,
  "priceInZone": true | false,
  "note": "<one short sentence summarising what you see>"
}`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: screenshot.toString("base64") },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    });

    const text = response.content.find((b) => b.type === "text")?.text ?? "";
    console.log("[fib-verify] raw:", text.trim());

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { confirmed: true, structureIntact: true, priceInZone: false, note: "parse failed — treating as confirmed" };
    }

    const raw = JSON.parse(jsonMatch[0]) as {
      confirmed?: boolean;
      structureIntact?: boolean;
      priceInZone?: boolean;
      note?: string;
    };

    return {
      confirmed: raw.confirmed !== false,
      structureIntact: raw.structureIntact !== false,
      priceInZone: raw.priceInZone === true,
      note: typeof raw.note === "string" ? raw.note : "",
    };
  } catch (err) {
    console.error("[fib-verify] error:", err);
    return { confirmed: true, structureIntact: true, priceInZone: false, note: "verify call failed — treating as confirmed" };
  }
}

export async function estimateFibonacciPlacementError(
  screenshot: Buffer,
  context: {
    direction: "long" | "short";
    timeframe: string;
    granularitySec: number;
    activeLeg: {
      lowTimeSec: number;
      lowPrice: number;
      highTimeSec: number;
      highPrice: number;
    };
  },
): Promise<FibonacciPlacementEstimate> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      confirmed: true,
      shouldAdjust: false,
      anchorCycle: "unclear",
      leftAnchorBarError: 0,
      rightAnchorBarError: 0,
      averageBarError: 0,
      confidence: 0,
      note: "ANTHROPIC_API_KEY missing — skipping placement estimate",
    };
  }

  const client = new Anthropic({ apiKey });
  const { direction, timeframe, granularitySec, activeLeg } = context;
  const lowIso = new Date(activeLeg.lowTimeSec * 1000).toISOString();
  const highIso = new Date(activeLeg.highTimeSec * 1000).toISOString();
  const barMinutes = Math.round(granularitySec / 60);
  const isBullish = direction === "long";

  const prompt = `A fibonacci retracement has been drawn on a ${timeframe} chart (${barMinutes}-minute candles).

Expected anchor points:
- Swing low: ${lowIso} at price ~${activeLeg.lowPrice}
- Swing high: ${highIso} at price ~${activeLeg.highPrice}
- Direction: ${isBullish ? "bullish low-to-high" : "bearish high-to-low"}

Your task is NOT to judge the trade. Your task is to estimate whether the DRAWN fibonacci is horizontally misplaced versus the intended swing candles.

Critical judgement rule:
- First decide whether the drawn fib is attached to the INTENDED LATEST visible swing near the current price action, or an OLDER LEFT-SIDE swing from earlier on the chart.
- If it is attached to an older left-side swing, you MUST return:
  - "anchorCycle": "older_left_swing"
  - "shouldAdjust": true
  - a NON-ZERO bar error
- Never return zero error if the fib is clearly attached to an older swing cycle.
- Use "intended_latest_swing" only when the fib endpoints visually belong to the latest intended swing that leads into the current reaction zone.
- Use "unclear" only if the image is too ambiguous to tell.

Use these rules:
- Measure in whole candles/bars.
- Negative bar error means the drawn anchor appears too far LEFT / too EARLY.
- Positive bar error means the drawn anchor appears too far RIGHT / too LATE.
- If the placement looks essentially correct, return 0.
- Focus on horizontal candle alignment first, not vertical styling.
- Be conservative. Only recommend adjustment when the error looks visually meaningful (about 3+ candles).

Respond ONLY with valid JSON:
{
  "confirmed": true | false,
  "shouldAdjust": true | false,
  "anchorCycle": "intended_latest_swing" | "older_left_swing" | "unclear",
  "leftAnchorBarError": <integer>,
  "rightAnchorBarError": <integer>,
  "averageBarError": <integer>,
  "confidence": <number 0 to 1>,
  "note": "<one short sentence>"
}`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 220,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: screenshot.toString("base64") },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    });

    const text = response.content.find((b) => b.type === "text")?.text ?? "";
    console.log("[fib-adjust] raw:", text.trim());

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        confirmed: true,
        shouldAdjust: false,
        anchorCycle: "unclear",
        leftAnchorBarError: 0,
        rightAnchorBarError: 0,
        averageBarError: 0,
        confidence: 0,
        note: "parse failed — skipping adjustment",
      };
    }

    const raw = JSON.parse(jsonMatch[0]) as {
      confirmed?: boolean;
      shouldAdjust?: boolean;
      anchorCycle?: "intended_latest_swing" | "older_left_swing" | "unclear";
      leftAnchorBarError?: number;
      rightAnchorBarError?: number;
      averageBarError?: number;
      confidence?: number;
      note?: string;
    };

    const leftAnchorBarError = Number.isFinite(raw.leftAnchorBarError)
      ? Math.round(raw.leftAnchorBarError as number)
      : 0;
    const rightAnchorBarError = Number.isFinite(raw.rightAnchorBarError)
      ? Math.round(raw.rightAnchorBarError as number)
      : 0;
    const averageBarError = Number.isFinite(raw.averageBarError)
      ? Math.round(raw.averageBarError as number)
      : Math.round((leftAnchorBarError + rightAnchorBarError) / 2);

    return {
      confirmed: raw.confirmed !== false,
      shouldAdjust: raw.shouldAdjust === true,
      anchorCycle:
        raw.anchorCycle === "intended_latest_swing" ||
        raw.anchorCycle === "older_left_swing" ||
        raw.anchorCycle === "unclear"
          ? raw.anchorCycle
          : "unclear",
      leftAnchorBarError,
      rightAnchorBarError,
      averageBarError,
      confidence:
        typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
          ? Math.max(0, Math.min(1, raw.confidence))
          : 0,
      note: typeof raw.note === "string" ? raw.note : "",
    };
  } catch (err) {
    console.error("[fib-adjust] error:", err);
    return {
      confirmed: true,
      shouldAdjust: false,
      anchorCycle: "unclear",
      leftAnchorBarError: 0,
      rightAnchorBarError: 0,
      averageBarError: 0,
      confidence: 0,
      note: "adjust call failed — skipping adjustment",
    };
  }
}
