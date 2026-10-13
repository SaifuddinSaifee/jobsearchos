"use client";

import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapse } from "@/components/ui/collapse";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ACCENT_COLORS, ACCENTS, FONT_STACKS, FONTS, MARGIN_LABELS, MARGINS, MAX_DENSITY, resolveMetrics, type PageSettings } from "@/lib/documents/page-settings";
import { cn } from "@/lib/utils";

function Segmented<T extends string>({ value, options, label, onChange }: { value: T; options: { value: T; label: string }[]; label: string; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-full rounded-lg bg-muted p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground outline-none transition-[background-color,color,box-shadow,scale] duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]",
            value === o.value && "bg-background text-foreground shadow-sm",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Font, spacing, accent and whether to keep to one page. Changes show on the page straight away. */
export function PageSettingsPanel({ settings, onChange, status }: { settings: PageSettings; onChange: (next: PageSettings) => void; status: string }) {
  const [fineOpen, setFineOpen] = useState(false);
  const m = resolveMetrics(settings);
  const hasOverrides = Object.keys(settings.overrides).length > 0;
  const setOverride = (key: keyof PageSettings["overrides"], raw: string) => {
    const n = Number(raw);
    const overrides = { ...settings.overrides };
    if (raw === "" || Number.isNaN(n)) delete overrides[key];
    else overrides[key] = n;
    onChange({ ...settings, overrides });
  };

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <SlidersHorizontal aria-hidden /> Page settings
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Label htmlFor="keep-one-page" className="font-medium">
              Keep to one page
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">{settings.fitOnePage ? "Spacing tightens as you write so it stays on one page. Your words are never cut." : "No limit. It can run to as many pages as it needs."}</p>
          </div>
          <Switch id="keep-one-page" checked={settings.fitOnePage} onCheckedChange={(checked) => onChange({ ...settings, fitOnePage: checked })} />
        </div>
        {status && <p className="rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground animate-in fade-in duration-200 motion-reduce:animate-none">{status}</p>}

        <div className="space-y-1.5">
          <Label>Font</Label>
          <Segmented label="Font" value={settings.font} options={FONTS.map((f) => ({ value: f, label: FONT_STACKS[f].label }))} onChange={(font) => onChange({ ...settings, font })} />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="density">Spacing</Label>
            <span className="text-xs text-muted-foreground">{settings.density === 0 ? "Roomy" : settings.density === MAX_DENSITY ? "Tightest" : `Step ${settings.density} of ${MAX_DENSITY}`}</span>
          </div>
          <Slider aria-label="Spacing" min={0} max={MAX_DENSITY} step={1} value={settings.density} onValueChange={(density) => onChange({ ...settings, density, overrides: settings.overrides.marginMm === undefined ? {} : { marginMm: settings.overrides.marginMm } })} />
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>Roomy</span>
            <span>Tight</span>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Margins</Label>
          <Segmented
            label="Margins"
            value={settings.margins}
            options={MARGINS.map((m) => ({ value: m, label: MARGIN_LABELS[m].split(" (")[0] }))}
            onChange={(margins) => onChange({ ...settings, margins, overrides: { ...settings.overrides, marginMm: undefined } })}
          />
          <p className="text-xs text-muted-foreground">{MARGIN_LABELS[settings.margins]} on every side{settings.overrides.marginMm !== undefined ? `, overridden to ${settings.overrides.marginMm} mm in fine tuning` : ""}.</p>
        </div>

        <div className="space-y-1.5">
          <Label>Accent colour</Label>
          <div role="radiogroup" aria-label="Accent colour" className="flex gap-2">
            {ACCENTS.map((a) => (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={settings.accent === a}
                aria-label={a === "none" ? "No accent" : a}
                title={a === "none" ? "None" : a[0].toUpperCase() + a.slice(1)}
                onClick={() => onChange({ ...settings, accent: a })}
                className={cn("size-7 rounded-full border-2 outline-none transition-[scale,box-shadow] duration-150 hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring active:scale-95", settings.accent === a ? "border-foreground" : "border-transparent ring-1 ring-foreground/15")}
                style={{ backgroundColor: ACCENT_COLORS[a] }}
              />
            ))}
          </div>
        </div>

        <div>
          <Button type="button" variant="link" size="sm" className="px-0" aria-expanded={fineOpen} onClick={() => setFineOpen((v) => !v)}>
            {fineOpen ? "Hide fine tuning" : "Fine tuning"}
          </Button>
          <Collapse open={fineOpen}>
            <div className="grid grid-cols-3 gap-2 pb-1">
              <div className="space-y-1">
                <Label htmlFor="fs" className="text-xs">
                  Size (pt)
                </Label>
                <Input id="fs" type="number" step="0.1" min={8} max={14} value={settings.overrides.fontSizePt ?? ""} placeholder={String(m.fontSizePt)} onChange={(e) => setOverride("fontSizePt", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="lh" className="text-xs">
                  Line height
                </Label>
                <Input id="lh" type="number" step="0.01" min={1} max={2} value={settings.overrides.lineHeight ?? ""} placeholder={String(m.lineHeight)} onChange={(e) => setOverride("lineHeight", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mg" className="text-xs">
                  Margin (mm)
                </Label>
                <Input id="mg" type="number" step="1" min={6} max={30} value={settings.overrides.marginMm ?? ""} placeholder={String(m.marginMm)} onChange={(e) => setOverride("marginMm", e.target.value)} />
              </div>
            </div>
            {hasOverrides && (
              <Button type="button" variant="ghost" size="xs" onClick={() => onChange({ ...settings, overrides: {} })}>
                <RotateCcw aria-hidden /> Reset fine tuning
              </Button>
            )}
          </Collapse>
        </div>
      </PopoverContent>
    </Popover>
  );
}
