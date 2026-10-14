/**
 * Runs once when the server starts: turns on model-call tracing when a Phoenix endpoint is set (docs/LLM-LOGGING.md),
 * then begins processing the background job queue. Tracing goes first so the queue's first calls are traced.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.PHOENIX_COLLECTOR_ENDPOINT) await (await import("./instrumentation.node")).startTracing();
    const { startQueueWorker } = await import("@/lib/queue/worker");
    startQueueWorker();
  }
}
