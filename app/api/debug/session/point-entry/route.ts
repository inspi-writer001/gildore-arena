import { NextResponse } from "next/server";
import { drawEntryOnChart } from "@/lib/browser-session-runtime";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { sessionId: string };

    if (!body.sessionId) {
      return NextResponse.json(
        { ok: false, error: "missing_session_id" },
        { status: 400 },
      );
    }

    await drawEntryOnChart(body.sessionId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[debug/session/point-entry] failed", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "draw_failed",
      },
      { status: 500 },
    );
  }
}
