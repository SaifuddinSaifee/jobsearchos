import type { OutreachEmailRow } from "@/lib/db/schema";
import { textToDoc } from "./convert/text-to-doc";
import { createDocument, type DbOrTx } from "./service";

/** A sent email as a library document: locked from the moment it was sent, because it cannot change. */
export async function createSentEmailDocument(email: OutreachEmailRow, tx: DbOrTx) {
  const sentAt = email.sentAt ?? email.updatedAt;
  return createDocument(
    {
      kind: "email",
      origin: "sent",
      title: email.subject.trim() || "Sent email",
      content: textToDoc(email.body, { mode: "letter" }),
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
