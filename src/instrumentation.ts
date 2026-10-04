/** Runs once when the server starts: begins processing the background job queue. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startQueueWorker } = await import("@/lib/queue/worker");
    startQueueWorker();
  }
}
