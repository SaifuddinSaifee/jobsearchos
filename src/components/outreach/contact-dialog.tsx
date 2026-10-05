"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { suggestEmails, type PatternId } from "@/lib/outreach/patterns";
import { CONTACT_KINDS, KIND_LABEL, type ContactDTO, type ContactKind } from "@/lib/outreach/types";
import { cn } from "@/lib/utils";

export type ContactForm = { name: string; title: string; email: string; kind: ContactKind; linkedinUrl: string };

const EMPTY: ContactForm = { name: "", title: "", email: "", kind: "hiring_manager", linkedinUrl: "" };

type Props = {
  open: boolean;
  /** The contact being edited; null to add a new one. */
  contact: ContactDTO | null;
  domain: string | null;
  /** Address formats already seen at this company. */
  patterns: PatternId[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (form: ContactForm) => void;
};

/** Adds a person by hand, or edits one. With the company's domain known, offers the usual address formats to pick from. */
export function ContactDialog(props: Props) {
  const { open, contact, busy, onClose } = props;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        {/* Mounted only while open, so the form starts from the right contact each time. */}
        <ContactFormBody key={contact?.id ?? "new"} {...props} />
      </DialogContent>
    </Dialog>
  );
}

function ContactFormBody({ contact, domain, patterns, busy, error, onClose, onSave }: Props) {
  const [form, setForm] = useState<ContactForm>(() =>
    contact
      ? { name: contact.name, title: contact.title, email: contact.email ?? "", kind: contact.kind, linkedinUrl: contact.linkedinUrl ?? "" }
      : EMPTY,
  );
  const set = <K extends keyof ContactForm>(k: K, v: ContactForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const suggestions = domain && !form.email.includes("@") ? suggestEmails(form.name, domain, patterns) : [];

  return (
    <>
      <DialogHeader>
        <DialogTitle>{contact ? "Edit contact" : "Add a contact"}</DialogTitle>
        <DialogDescription>
          {contact ? "Changing the email address resets its verification." : "Someone you found yourself, for example on LinkedIn or the company's team page."}
        </DialogDescription>
      </DialogHeader>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) onSave(form);
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="c-name">Name</Label>
          <Input id="c-name" autoFocus value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Jane Doe" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="c-title">Title</Label>
            <Input id="c-title" value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Head of Data" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-kind">Role in hiring</Label>
            <NativeSelect id="c-kind" value={form.kind} onChange={(e) => set("kind", e.target.value as ContactKind)}>
              {CONTACT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-email">Email</Label>
          <Input id="c-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="jane@company.com" />
          {suggestions.length > 0 && (
            <div className="space-y-1.5 pt-0.5">
              <p className="text-xs text-muted-foreground">
                {patterns.length > 0 ? `Formats used at ${domain}, most likely first.` : `Common formats at ${domain}.`} These are guesses, so check one before you trust it.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.slice(0, 4).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => set("email", s)}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-xs outline-none transition-[background-color,border-color,scale]",
                      "hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring active:scale-95",
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-linkedin">LinkedIn profile (optional)</Label>
          <Input id="c-linkedin" value={form.linkedinUrl} onChange={(e) => set("linkedinUrl", e.target.value)} placeholder="https://linkedin.com/in/..." />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={!form.name.trim()}>
            {contact ? "Save changes" : "Add contact"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
