"use client";

import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Both fields keep their own text while typing and only push parsed arrays up,
 * so trailing newlines/commas don't get stripped under the cursor.
 * Remount with a new `key` to load externally changed values.
 */

export function LinesField({
  label,
  value,
  onChange,
  rows = 4,
  placeholder,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  rows?: number;
  placeholder?: string;
}) {
  const [text, setText] = useState(value.join("\n"));
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        rows={rows}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          onChange(
            e.target.value
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean),
          );
        }}
      />
      <p className="text-xs text-muted-foreground">One item per line.</p>
    </div>
  );
}

export function TagsField({
  label,
  value,
  onChange,
  placeholder,
  hint = "Separate with commas.",
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  hint?: string;
}) {
  const [text, setText] = useState(value.join(", "));
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          onChange(
            e.target.value
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
          );
        }}
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
