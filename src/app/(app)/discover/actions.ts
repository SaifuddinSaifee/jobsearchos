"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { addDiscoveredAgain } from "@/lib/discover/service";

export type AddAgainResult = { ok: true; state: "queued" | "in_jobs" | "not_added"; reason?: string } | { ok: false; error: string };

/** Adds a discovered job to the queue again (after its job was removed or it could not be added). */
export async function addDiscoveredAgainAction(id: string): Promise<AddAgainResult> {
  try {
    const res = await addDiscoveredAgain(z.uuid().parse(id));
    revalidatePath("/discover");
    return { ok: true, state: res.state, reason: res.state === "not_added" ? res.reason : undefined };
  } catch (err) {
    return { ok: false, error: err instanceof z.ZodError ? "Invalid request" : err instanceof Error ? err.message : "Something went wrong" };
  }
}
