import { subscribeControlledBrowserStream } from "@/lib/browser-session-runtime";

// Wait up to 20 seconds for startControlledBrowserSession to register the runtime.
// This prevents a 404 race when the Convex reactive update mounts the viewport
// before the /api/browser-session/start POST has completed.
async function waitForRuntime(sessionId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      subscribeControlledBrowserStream(sessionId, () => {})();
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return false;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;

  const available = await waitForRuntime(sessionId);
  if (!available) {
    return Response.json(
      { ok: false, error: "browser_stream_unavailable" },
      { status: 404 },
    );
  }

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

      cleanup = () => {
        clearInterval(keepAlive);
        unsubscribe();
      };
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
}
