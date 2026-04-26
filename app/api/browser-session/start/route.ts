import { NextResponse } from "next/server";
import { startControlledBrowserSession } from "@/lib/browser-session-runtime";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      sessionId: string;
      marketSymbol: string;
      timeframe: string;
      targetUrl: string;
    };

    if (!body.sessionId || !body.marketSymbol || !body.timeframe || !body.targetUrl) {
      return NextResponse.json(
        { ok: false, error: "missing_required_fields" },
        { status: 400 },
      );
    }

    const result = await startControlledBrowserSession(body);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "browser_session_failed",
      },
      { status: 500 },
    );
  }
}
