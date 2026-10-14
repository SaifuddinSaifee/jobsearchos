"use client";

import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Include or leave out one item of a proposal. Shown as a check when included and a cross when left out. */
export function IncludeToggle({
  included,
  onChange,
  label,
  disabled,
}: {
  included: boolean;
  onChange: (included: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      size="icon-xs"
      variant={included ? "secondary" : "outline"}
      aria-pressed={included}
      aria-label={`${included ? "Leave out" : "Include"} ${label}`}
      title={included ? "Included. Click to leave out." : "Left out. Click to include."}
      disabled={disabled}
      onClick={() => onChange(!included)}
      className="shrink-0"
    >
      {included ? <Check aria-hidden /> : <X aria-hidden />}
    </Button>
  );
}
