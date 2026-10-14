"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

export type PromptField =
  | { name: string; label: string; kind: "text"; value: string; optional?: boolean }
  | { name: string; label: string; kind: "textarea"; value: string }
  | { name: string; label: string; kind: "checkbox"; value: boolean }
  | { name: string; label: string; kind: "select"; value: string; options: { value: string; label: string }[] };

export type PromptValues = Record<string, string | boolean>;

/** A small form (or a plain confirmation, with no fields) shown in the shared dialog of the career record. */
export type PromptSpec = {
  title: string;
  description?: string;
  fields: PromptField[];
  submitLabel: string;
  destructive?: boolean;
  /** Resolves true to close the dialog. */
  onSubmit: (values: PromptValues) => Promise<boolean>;
};

/** A request for the shared dialog; `key` is new for each request so the form starts from its own values. */
export type OpenPrompt = PromptSpec & { key: number };

export function PromptDialog({ spec, onClose }: { spec: OpenPrompt | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={spec !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>{spec && <PromptForm key={spec.key} spec={spec} busy={busy} setBusy={setBusy} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function PromptForm({
  spec,
  busy,
  setBusy,
  onClose,
}: {
  spec: PromptSpec;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState<PromptValues>(() => Object.fromEntries(spec.fields.map((f) => [f.name, f.value])));

  const missing = spec.fields.some(
    (f) => f.kind !== "checkbox" && f.kind !== "select" && !("optional" in f && f.optional) && !String(values[f.name] ?? "").trim(),
  );

  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      if (await spec.onSubmit(values)) onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{spec.title}</DialogTitle>
        {spec.description && <DialogDescription>{spec.description}</DialogDescription>}
      </DialogHeader>
      {spec.fields.map((f, i) => (
        <label key={f.name} className="block space-y-1.5 text-sm">
          {f.kind === "checkbox" ? (
            <span className="flex items-center gap-2">
              <input
                type="checkbox"
                className="size-4 rounded border-input"
                checked={Boolean(values[f.name])}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.checked }))}
              />
              {f.label}
            </span>
          ) : (
            <>
              <span className="text-muted-foreground">{f.label}</span>
              {f.kind === "textarea" ? (
                <Textarea
                  autoFocus={i === 0}
                  rows={4}
                  value={String(values[f.name] ?? "")}
                  onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                />
              ) : f.kind === "select" ? (
                <NativeSelect value={String(values[f.name] ?? "")} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <Input autoFocus={i === 0} value={String(values[f.name] ?? "")} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} />
              )}
            </>
          )}
        </label>
      ))}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant={spec.destructive ? "destructive" : "default"} loading={busy} disabled={missing}>
          {spec.submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
