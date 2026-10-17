import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<AbortSignal>();

/**
 * Runs `fn` with a signal that every model call inside it obeys, however deep, so a background job can be stopped
 * without threading the signal through each step.
 */
export function withAbortSignal<T>(signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
  return store.run(signal, fn);
}

export function currentAbortSignal(): AbortSignal | undefined {
  return store.getStore();
}

/** Whether a failed call failed because the running job was stopped: such a call is never tried again. */
export function isStopped(err: unknown): boolean {
  return currentAbortSignal()?.aborted === true || (err instanceof Error && err.message === "Stopped");
}
