// Safe to import from client code.

export const DOCUMENT_KINDS = ["resume", "cover_letter", "email"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const KIND_LABELS: Record<DocumentKind, string> = {
  resume: "Resume",
  cover_letter: "Cover letter",
  email: "Email",
};

/** Where a document came from. */
export const DOCUMENT_ORIGINS = ["uploaded", "pasted", "blank", "copied", "sent", "generated"] as const;
export type DocumentOrigin = (typeof DOCUMENT_ORIGINS)[number];

/** Why a version was made. Manual saves, exports and attachments are the ones the user chose. */
export const VERSION_REASONS = ["manual", "export", "attach", "applied", "upload", "structured", "restore", "migrated", "sent"] as const;
export type VersionReason = (typeof VERSION_REASONS)[number];

export const REASON_LABELS: Record<VersionReason, string> = {
  manual: "Saved",
  export: "Exported",
  attach: "Attached to an email",
  applied: "Applied",
  upload: "Uploaded",
  structured: "Structured from upload",
  restore: "Restored",
  migrated: "Imported",
  sent: "Sent",
};

/** Bumped if the editor document format ever changes in a way old content cannot be read as-is. */
export const CONTENT_SCHEMA_VERSION = 1;
