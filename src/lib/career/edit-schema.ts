import { z } from "zod";

// The changes a user can make to the career record by hand. Client-safe; checked again on the server.

const id = z.string().min(1).max(64);
const text = z.string().trim().min(1).max(4000);
const short = z.string().trim().max(200);

export const SIMPLE_KINDS = ["skill", "project", "education", "certification", "achievement", "motivation"] as const;
export type SimpleKind = (typeof SIMPLE_KINDS)[number];

export const EditOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("editWording"), wordingId: id, text }),
  z.object({ op: z.literal("addWording"), factId: id, text, framingId: id.nullable() }),
  /** `toFactId` null makes the wording a fact of its own. */
  z.object({ op: z.literal("moveWording"), wordingId: id, toFactId: id.nullable() }),
  z.object({ op: z.literal("deleteWording"), wordingId: id }),
  z.object({ op: z.literal("addFact"), roleId: id, text, framingId: id.nullable() }),
  z.object({ op: z.literal("mergeFacts"), factId: id, intoFactId: id }),
  z.object({ op: z.literal("deleteFact"), factId: id }),
  z.object({
    op: z.literal("editRole"),
    roleId: id,
    start: short.optional(),
    end: short.optional(),
    current: z.boolean().optional(),
    location: short.optional(),
  }),
  z.object({ op: z.literal("addFraming"), roleId: id, title: short.min(1), angle: short }),
  z.object({ op: z.literal("editFraming"), framingId: id, title: short.min(1).optional(), angle: short.optional() }),
  /** Moves a framing, with the wordings written for it, into a role of its own. */
  z.object({ op: z.literal("splitFraming"), framingId: id }),
  z.object({ op: z.literal("mergeRoles"), roleId: id, intoRoleId: id }),
  z.object({ op: z.literal("deleteRole"), roleId: id }),
  z.object({ op: z.literal("editEmployer"), employerId: id, name: short.min(1) }),
  z.object({ op: z.literal("deleteEmployer"), employerId: id }),
  z.object({ op: z.literal("addSkill"), name: short.min(1), category: short }),
  z.object({ op: z.literal("editSkill"), skillId: id, name: short.min(1).optional(), category: short.optional() }),
  z.object({ op: z.literal("addAchievement"), text }),
  z.object({ op: z.literal("editAchievement"), achievementId: id, text }),
  z.object({ op: z.literal("deleteItem"), kind: z.enum(SIMPLE_KINDS), itemId: id }),
]);

export type EditOp = z.infer<typeof EditOpSchema>;
