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
