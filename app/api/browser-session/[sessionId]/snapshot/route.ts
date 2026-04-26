import { NextResponse } from "next/server";
import { readControlledBrowserScreenshot } from "@/lib/browser-session-runtime";

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await context.params;
    const bytes = await readControlledBrowserScreenshot(sessionId);

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "snapshot_unavailable" },
      { status: 404 },
    );
  }
}
