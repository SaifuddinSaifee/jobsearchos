import { describe, expect, it } from "vitest";
import { fitToPage, linePx, linesOver, pageLimitPx, pagesNeeded } from "@/lib/documents/fit";
import { contentHeightPx, defaultPageSettings, MAX_DENSITY, PageSettingsSchema } from "@/lib/documents/page-settings";

const base = defaultPageSettings();

/** A stand-in for the browser: content gets shorter as the density rises. */
const shrinking = (heightAtZero: number, perStep: number) => (s: { density: number }) => heightAtZero - s.density * perStep;

describe("the one page setting", () => {
  it("is on by default, and can be switched off", () => {
    expect(base.fitOnePage).toBe(true);
    expect(PageSettingsSchema.parse({ fitOnePage: false }).fitOnePage).toBe(false);
  });
});

describe("page limits", () => {
  it("allows one page's worth of content", () => {
    expect(pageLimitPx(base)).toBeCloseTo(contentHeightPx(base), 5);
  });

  it("counts the lines over, rounding up, and none when it fits", () => {
    const limit = pageLimitPx(base);
    expect(linesOver(limit - 10, base)).toBe(0);
    expect(linesOver(limit, base)).toBe(0);
    expect(linesOver(limit + 1, base)).toBe(1);
    expect(linesOver(limit + linePx(base) * 2.2, base)).toBe(3);
  });

  it("counts pages", () => {
    const one = contentHeightPx(base);
    expect(pagesNeeded(10, base)).toBe(1);
    expect(pagesNeeded(one, base)).toBe(1);
    expect(pagesNeeded(one + 5, base)).toBe(2);
    expect(pagesNeeded(one * 2 + 5, base)).toBe(3);
  });
});

describe("fitToPage", () => {
  it("leaves things alone when the content already fits", () => {
    const out = fitToPage(base, () => 100);
    expect(out).toMatchObject({ fits: true, overPx: 0 });
    expect(out.settings.density).toBe(base.density);
  });

  it("picks the loosest density that fits", () => {
    const limit = pageLimitPx(base);
    // Needs 3 steps tighter than the starting density to get under the limit.
    const measure = (s: { density: number }) => limit + 120 - (s.density - base.density) * 45;
    const out = fitToPage(base, measure);
    expect(out.fits).toBe(true);
    expect(out.settings.density).toBe(base.density + 3);
  });

  it("never loosens the layout", () => {
    const tight = { ...base, density: 6 };
    expect(fitToPage(tight, () => 10).settings.density).toBe(6);
  });

  it("reports how far over it is when nothing fits, at the tightest density, and changes no text", () => {
    const limit = pageLimitPx(base);
    const out = fitToPage(base, shrinking(limit + 600, 5));
    expect(out.fits).toBe(false);
    expect(out.settings.density).toBe(MAX_DENSITY);
    // The page also gets roomier as the margins tighten, so the limit at the tightest density is the one that counts.
    const tightest = { ...base, density: MAX_DENSITY, overrides: {} };
    expect(out.overPx).toBeCloseTo(limit + 600 - MAX_DENSITY * 5 - pageLimitPx(tightest), 5);
  });

  it("clears the font and line controls, which would override the density steps, but keeps a margin set by hand", () => {
    const withOverrides = { ...base, overrides: { fontSizePt: 12, lineHeight: 1.5, marginMm: 25 } };
    expect(fitToPage(withOverrides, () => 10).settings.overrides).toEqual({ marginMm: 25 });
    expect(fitToPage({ ...base, overrides: { fontSizePt: 12 } }, () => 10).settings.overrides).toEqual({});
  });
});
