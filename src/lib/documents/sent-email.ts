import type { OutreachEmailRow } from "@/lib/db/schema";
import { lineRuns, trimEmailDoc, type EmailDoc } from "@/lib/outreach/body";
import type { DocJSON } from "./build";
import { textToDoc } from "./convert/text-to-doc";
import { createDocument, type DbOrTx } from "./service";

/**
 * A formatted email as a library letter: each line a paragraph with its bold, italic, underline and links kept. Blank
 * lines are dropped, because a letter's paragraphs are already spaced apart.
 */
export function emailDocToLetter(doc: EmailDoc): DocJSON {
  const paragraphs = trimEmailDoc(doc)
    .content.filter((l) => (l.content ?? []).some((t) => t.text.trim()))
    .map((l) => ({ type: "paragraph", content: lineRuns(l).flatMap((r) => r.parts.map((p) => ({ ...p }))) }));
  return { type: "doc", content: paragraphs.length > 0 ? paragraphs : [{ type: "paragraph" }] };
}

/** A sent email as a library document: locked from the moment it was sent, because it cannot change. */
export async function createSentEmailDocument(email: OutreachEmailRow, tx: DbOrTx) {
  const sentAt = email.sentAt ?? email.updatedAt;
  return createDocument(
    {
      kind: "email",
      origin: "sent",
      title: email.subject.trim() || "Sent email",
      content: email.bodyDoc ? emailDocToLetter(email.bodyDoc) : textToDoc(email.body, { mode: "letter" }),
      subject: email.subject,
      jobId: email.jobId,
      outreachEmailId: email.id,
      reason: "sent",
      createdAt: sentAt,
      lockedAt: sentAt,
    },
    tx,
  );
}
