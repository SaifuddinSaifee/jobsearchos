"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  createQuickLink,
  deleteQuickLink,
  markQuickLinksOpened,
  moveQuickLink,
  updateQuickLink,
} from "@/lib/quick-links/service";
import { QuickLinkInputSchema } from "@/lib/quick-links/types";

const Id = z.uuid();

export type QuickLinkResult = { ok: true } | { ok: false; error: string };

async function run(fn: () => Promise<unknown>): Promise<QuickLinkResult> {
  try {
    await fn();
    revalidatePath("/links");
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    if (err instanceof z.ZodError) return { ok: false, error: err.issues[0]?.message ?? "Invalid request" };
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" };
  }
}

export async function createQuickLinkAction(input: unknown) {
  return run(() => createQuickLink(QuickLinkInputSchema.parse(input)));
}

export async function updateQuickLinkAction(id: string, input: unknown) {
  return run(() => updateQuickLink(Id.parse(id), QuickLinkInputSchema.parse(input)));
}

export async function deleteQuickLinkAction(id: string) {
  return run(() => deleteQuickLink(Id.parse(id)));
}

export async function moveQuickLinkAction(id: string, direction: "up" | "down") {
  return run(() => moveQuickLink(Id.parse(id), z.enum(["up", "down"]).parse(direction)));
}

export async function markQuickLinksOpenedAction(ids: string[]) {
  return run(() => markQuickLinksOpened(z.array(Id).max(500).parse(ids)));
}
