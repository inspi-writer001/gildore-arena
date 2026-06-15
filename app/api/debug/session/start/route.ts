import { NextResponse } from "next/server";
import { startDebugBrowserSession } from "@/lib/browser-session-runtime";

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      agentSlug: string;
      marketSymbol: string;
      timeframe: string;
      targetUrl?: string;
    };

    if (!body.agentSlug || !body.marketSymbol || !body.timeframe) {
      return NextResponse.json(
        { ok: false, error: "missing_required_fields" },
        { status: 400 },
      );
    }

    const { sessionId, durationMs, capturedViews } = await startDebugBrowserSession({
      agentSlug: body.agentSlug,
      marketSymbol: body.marketSymbol,
      timeframe: body.timeframe,
      targetUrl: body.targetUrl ?? "https://charts.deriv.com/deriv",
    });

    return NextResponse.json({ ok: true, sessionId, durationMs, capturedViews });
  } catch (error) {
    console.error("[debug/session/start] failed", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "session_start_failed",
      },
      { status: 500 },
    );
  }
}
