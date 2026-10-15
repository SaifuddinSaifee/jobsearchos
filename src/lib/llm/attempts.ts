import { AsyncLocalStorage } from "node:async_hooks";

// The SDK retries a refused or failed request inside one `create` call, out of our sight. The client's `fetch` notes
// each try here, so every call's record says how often it was retried and how long it waited.

/** When each HTTP attempt of one call started and ended (headers in, or failed), in milliseconds since the epoch. */
export type Attempts = { starts: number[]; ends: number[] };

const store = new AsyncLocalStorage<Attempts>();

/** Runs `fn` with every HTTP attempt it makes noted in `attempts`. */
export const countAttempts = <T>(attempts: Attempts, fn: () => Promise<T>): Promise<T> => store.run(attempts, fn);

/** How many times a call was retried, and how long it spent between tries (the SDK's backoff and the gaps around it). */
export function retryStats(a: Attempts): { retryCount: number; retryWaitMs: number } {
  let wait = 0;
  for (let i = 1; i < a.starts.length; i++) wait += Math.max(0, a.starts[i] - (a.ends[i - 1] ?? a.starts[i]));
  return { retryCount: Math.max(0, a.starts.length - 1), retryWaitMs: wait };
}

/** `fetch` that notes each attempt in the current call's `Attempts`, if any. */
export const countingFetch: typeof fetch = async (input, init) => {
  const attempts = store.getStore();
  attempts?.starts.push(Date.now());
  try {
    return await fetch(input, init);
  } finally {
    attempts?.ends.push(Date.now());
  }
};
