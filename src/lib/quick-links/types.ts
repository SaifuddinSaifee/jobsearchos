import { z } from "zod";
import { safeHref } from "@/lib/jobs/links";

export type QuickLink = {
  id: string;
  title: string;
  url: string;
  note: string;
  group: string;
  /** ISO time of the last click; "opened today" is judged in the browser's own time zone. */
  lastOpenedAt: string | null;
};

/** Accepts "linkedin.com/jobs" as well as full URLs; only http(s) links are kept. */
const Url = z
  .string()
  .trim()
  .min(1, "Enter a link")
  .max(2000)
  .transform((v, ctx) => {
    const href = safeHref(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`);
    if (!href) {
      ctx.addIssue({ code: "custom", message: "Enter a valid web link" });
      return z.NEVER;
    }
    return href;
  });

export const QuickLinkInputSchema = z.object({
  title: z.string().trim().min(1, "Enter a name").max(120),
  url: Url,
  note: z.string().trim().max(300).default(""),
  group: z.string().trim().max(60).default(""),
});

export type QuickLinkInput = z.output<typeof QuickLinkInputSchema>;
