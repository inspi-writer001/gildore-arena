import { subscribeControlledBrowserStream } from "@/lib/browser-session-runtime";

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;

  try {
    let cleanup: (() => void) | null = null;

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();

        const unsubscribe = subscribeControlledBrowserStream(sessionId, (payload) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
          );
        });

        const keepAlive = setInterval(() => {
          controller.enqueue(encoder.encode(`event: ping\ndata: ${Date.now()}\n\n`));
        }, 15000);

        const dispose = () => {
          clearInterval(keepAlive);
          unsubscribe();
        };
        cleanup = dispose;
      },
      cancel() {
        cleanup?.();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch {
    return Response.json(
      { ok: false, error: "browser_stream_unavailable" },
      { status: 404 },
    );
  }
}
