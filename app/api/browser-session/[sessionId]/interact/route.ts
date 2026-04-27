import { NextResponse } from "next/server";
import {
  interactWithBrowserSession,
  type BrowserInteractEvent,
} from "@/lib/browser-session-runtime";

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;

  try {
    const event = (await request.json()) as BrowserInteractEvent;
    await interactWithBrowserSession(sessionId, event);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "interact_failed" },
      { status: 500 },
    );
  }
}
