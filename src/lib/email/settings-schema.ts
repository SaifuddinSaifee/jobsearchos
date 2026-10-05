// Pure (no database import) so client components can use it for form validation.
import { z } from "zod";

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const ANGLES = ["auto", "proof_of_work", "value_offer", "question", "direct"] as const;
export const CONTACT_PROVIDERS = ["hunter", "apollo"] as const;

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM, 24-hour");

/** Cold-email configuration. Defaults come from docs/cold-email.md. */
export const ColdEmailSettingsSchema = z
  .object({
    // Sending
    dailyCap: z.number().int().min(1).max(100),
    sendDays: z.array(z.enum(WEEKDAYS)).min(1, "Pick at least one day"),
    sendWindowStart: Time,
    sendWindowEnd: Time,
    useRecipientTimeZone: z.boolean(),
    followUpBusinessDays: z.number().int().min(1).max(30),
    maxFollowUps: z.number().int().min(0).max(2),
    bccSelf: z.boolean(),
    requireVerifiedAddress: z.boolean(),
    // Writing
    senderName: z.string().trim(),
    signOff: z.string().trim(),
    links: z
      .array(z.object({ label: z.string().trim().min(1), url: z.url() }))
      .max(2, "At most two links"),
    minWords: z.number().int().min(20).max(300),
    maxWords: z.number().int().min(20).max(300),
    followUpMaxWords: z.number().int().min(10).max(200),
    extraBannedPhrases: z.array(z.string().trim().min(1)),
    defaultAngle: z.enum(ANGLES),
    // Contacts
    providerOrder: z.array(z.enum(CONTACT_PROVIDERS)),
    excludeGenericInboxes: z.boolean(),
  })
  .refine((s) => s.minWords <= s.maxWords, {
    path: ["maxWords"],
    message: "Must be at least the minimum",
  })
  .refine((s) => s.sendWindowStart < s.sendWindowEnd, {
    path: ["sendWindowEnd"],
    message: "Must be after the start",
  });

export type ColdEmailSettings = z.infer<typeof ColdEmailSettingsSchema>;

export const defaultColdEmailSettings = (): ColdEmailSettings => ({
  dailyCap: 25,
  sendDays: ["tue", "wed", "thu"],
  sendWindowStart: "09:00",
  sendWindowEnd: "11:00",
  useRecipientTimeZone: true,
  followUpBusinessDays: 5,
  maxFollowUps: 1,
  bccSelf: false,
  requireVerifiedAddress: true,
  senderName: "",
  signOff: "",
  links: [],
  minWords: 60,
  maxWords: 120,
  followUpMaxWords: 50,
  extraBannedPhrases: [],
  defaultAngle: "auto",
  providerOrder: ["hunter", "apollo"],
  excludeGenericInboxes: true,
});
