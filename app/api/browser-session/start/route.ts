import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { startControlledBrowserSession, type SwingPointsForBrowser } from "@/lib/browser-session-runtime";

function getConvexClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured.");
  }

  return new ConvexHttpClient(url);
}

export async function POST(request: Request) {
  let sessionId: string | undefined;

  try {
    const body = (await request.json()) as {
      sessionId: string;
      agentSlug: string;
      agentMarketSymbol: string;
      marketSymbol: string;
      timeframe: string;
      targetUrl: string;
      swingPoints?: SwingPointsForBrowser;
    };
    sessionId = body.sessionId;

    if (!body.sessionId || !body.marketSymbol || !body.timeframe || !body.targetUrl) {
      return NextResponse.json(
        { ok: false, error: "missing_required_fields" },
        { status: 400 },
      );
    }

    const result = await startControlledBrowserSession({
      sessionId: body.sessionId,
      agentSlug: body.agentSlug,
      agentMarketSymbol: body.agentMarketSymbol,
      marketSymbol: body.marketSymbol,
      timeframe: body.timeframe,
      targetUrl: body.targetUrl,
      swingPoints: body.swingPoints,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (sessionId) {
      try {
        const convex = getConvexClient();
        await convex.mutation(api.arena.updateBrowserSessionState, {
          sessionId: sessionId as never,
          status: "failed",
          currentStepLabel: "Browser startup failed",
          currentStepIndex: 1,
          error: error instanceof Error ? error.message : "browser_session_failed",
        });
      } catch {}
    }

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "browser_session_failed",
      },
      { status: 500 },
    );
  }
}
