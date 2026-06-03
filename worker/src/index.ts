import fs from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { startControlledBrowserSession } from "@/lib/browser-session-runtime";
import type { SetupLifecycleState, TradeTimeframe } from "@/lib/arena-types";
import { resolveThirdTouchSwingPoints } from "@/lib/third-touch-review";

const POLL_INTERVAL_MS = 60_000;
const TARGET_URL = "https://charts.deriv.com/deriv";

function loadWorkerEnv() {
  const envFiles = [
    ".env.local",
    ".env.development.local",
    ".env",
  ];

  for (const relativePath of envFiles) {
    const fullPath = path.resolve(process.cwd(), relativePath);
    if (!fs.existsSync(fullPath)) continue;

    try {
      process.loadEnvFile(fullPath);
    } catch (error) {
      console.warn("[arena-worker] failed to load env file", {
        file: relativePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function getConvexClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured.");
  }

  return new ConvexHttpClient(url);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runAnalysisJob(client: ConvexHttpClient) {
  const claimed = await client.mutation(api.arena.claimNextDueAnalysisJob, {
    now: Date.now(),
  });

  if (!claimed) {
    return false;
  }

  const startedAt = Date.now();
  await client.mutation(api.arena.markAnalysisJobRunning, {
    jobId: claimed.jobId,
    startedAt,
  });

  try {
    const reviewSession = await client.action(api.arena.startBrowserReviewSession, {
      agentSlug: claimed.agentSlug,
      marketSymbol: claimed.marketSymbol,
      timeframe: claimed.timeframe,
    });

    const swingResolution =
      claimed.agentSlug === "third-touch"
        ? await resolveThirdTouchSwingPoints({
            convex: client,
            agentSlug: claimed.agentSlug,
            marketSymbol: claimed.marketSymbol,
            timeframe: claimed.timeframe as TradeTimeframe,
          })
        : { swingPoints: undefined };

    await startControlledBrowserSession({
      sessionId: reviewSession.sessionId,
      agentSlug: claimed.agentSlug,
      agentMarketSymbol: claimed.marketSymbol,
      marketSymbol: reviewSession.browserTargetSymbol,
      timeframe: reviewSession.browserTargetTimeframe,
      targetUrl: TARGET_URL,
      swingPoints: swingResolution.swingPoints,
    });

    const snapshot = await client.query(api.arena.getArenaSnapshot, {});
    const activeSetup =
      snapshot.strategySetups.find(
        (setup) =>
          setup.agentSlug === claimed.agentSlug &&
          setup.marketSymbol === claimed.marketSymbol &&
          setup.isActive,
      ) ?? null;

    await client.mutation(api.arena.markAnalysisJobCompleted, {
      jobId: claimed.jobId,
      finishedAt: Date.now(),
      resultSetupState: activeSetup?.state as SetupLifecycleState | undefined,
    });

    console.log("[arena-worker] completed job", {
      jobId: claimed.jobId,
      agentSlug: claimed.agentSlug,
      marketSymbol: claimed.marketSymbol,
      state: activeSetup?.state ?? null,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "arena_worker_job_failed";
    await client.mutation(api.arena.markAnalysisJobFailed, {
      jobId: claimed.jobId,
      finishedAt: Date.now(),
      error: message,
    });
    console.error("[arena-worker] job failed", {
      jobId: claimed.jobId,
      agentSlug: claimed.agentSlug,
      marketSymbol: claimed.marketSymbol,
      error: message,
    });
  }

  return true;
}

async function main() {
  loadWorkerEnv();
  const client = getConvexClient();
  let idlePollCount = 0;
  console.log("[arena-worker] started", {
    pollIntervalMs: POLL_INTERVAL_MS,
    timezone: "Africa/Lagos",
  });

  while (true) {
    try {
      const didWork = await runAnalysisJob(client);
      if (!didWork) {
        idlePollCount += 1;
        console.log("[arena-worker] idle", {
          idlePollCount,
          nextPollInMs: POLL_INTERVAL_MS,
        });
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      idlePollCount = 0;
    } catch (error) {
      console.error("[arena-worker] loop error", error);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

void main();
