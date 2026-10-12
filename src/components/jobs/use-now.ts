"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  const id = setInterval(onChange, 60_000);
  return () => clearInterval(id);
}

const minute = () => Math.floor(Date.now() / 60_000);

/** Current time at minute granularity; null on the server and during hydration. */
export function useNow(): Date | null {
  const m = useSyncExternalStore(subscribe, minute, () => null);
  return m === null ? null : new Date(m * 60_000);
}
