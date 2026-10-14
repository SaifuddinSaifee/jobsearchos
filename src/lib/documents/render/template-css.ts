import { FONTS, resolveMetrics, type PageSettings } from "../page-settings";

// One template, three users: the editor page, the measuring copy and the PDF all use this CSS, so what you see is
// what is exported. The class names come from the node definitions in ../nodes.ts. Nothing here is print-only
// except @page, and nothing changes layout between screen and print.

const FAMILIES = { carlito: "Carlito", arimo: "Arimo", tinos: "Tinos" } as const satisfies Record<(typeof FONTS)[number], string>;

/** Each font ships as two files, so names with accents beyond Western Europe still use the same family. */
const SUBSETS = [
  {
    name: "latin",
    range: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
  },
  {
    name: "latin-ext",
    range: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
  },
] as const;

/** @font-face rules for the three bundled fonts (files in public/fonts). `base` is where /fonts is served from. */
export function fontFaceCss(base = ""): string {
  const rules: string[] = [];
  for (const font of FONTS) {
    for (const subset of SUBSETS) {
      for (const [weight, style] of [
        [400, "normal"],
        [700, "normal"],
        [400, "italic"],
        [700, "italic"],
      ] as const) {
        rules.push(
          `@font-face{font-family:"${FAMILIES[font]}";font-weight:${weight};font-style:${style};font-display:block;unicode-range:${subset.range};src:url("${base}/fonts/${font}-${subset.name}-${weight}-${style}.woff2") format("woff2")}`,
        );
      }
    }
  }
  return rules.join("\n");
}

/** The look of the page contents. Values come from CSS variables set by `styleVars`. */
export const CONTENT_CSS = `
.rs-page{font-family:var(--rs-font);font-size:var(--rs-font-size);line-height:var(--rs-line-height);color:#111;background:#fff;text-align:justify;font-kerning:normal;text-rendering:geometricPrecision;-webkit-font-smoothing:antialiased}
.rs-page *{box-sizing:border-box}
:where(.rs-page) :where(h1,h2,p,ul,li){margin:0;padding:0}
.rs-page a{color:inherit;text-decoration:underline}
.rs-page p:empty{min-height:1lh}

.rs-header{text-align:center}
.rs-header + :not(.rs-section){margin-top:calc(var(--rs-section-gap) * .6)}
.rs-name{font-size:2em;font-weight:700;line-height:1.15;color:var(--rs-accent)}
.rs-headline{font-size:1.05em}
.rs-headline:empty{display:none}
.rs-contact{font-size:.95em}
.rs-contact a{text-decoration:none}

.rs-section{margin-top:var(--rs-section-gap)}
.rs-section-title{font-size:1em;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--rs-accent);border-bottom:1px solid var(--rs-accent);padding-bottom:1pt;margin-bottom:calc(var(--rs-item-gap) * .8)}
.rs-section > p + p{margin-top:calc(var(--rs-item-gap) * .6)}

.rs-edu{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:12pt;margin-top:var(--rs-item-gap)}
.rs-role{display:flex;flex-wrap:wrap;align-items:baseline;margin-top:var(--rs-item-gap)}
.rs-role-title{order:1}
.rs-role-company{order:2}
.rs-role-location{order:3}
.rs-role-dates{order:4;margin-left:auto;padding-left:12pt}
.rs-role > .rs-bullets{order:5;flex:0 0 100%}
.rs-role-company:not(:empty):not(.is-empty)::before,.rs-role-location:not(:empty):not(.is-empty)::before{content:", ";font-style:normal;font-weight:400}
.rs-section-title + .rs-role,.rs-section-title + .rs-edu,.rs-section-title + .rs-project{margin-top:0}
.rs-role-title,.rs-edu-institution,.rs-project-name{font-weight:700}
.rs-role-dates,.rs-edu-dates{text-align:right;white-space:nowrap}
.rs-role-company{font-style:italic}
.rs-edu-degree,.rs-edu-details{grid-column:1 / -1}
.rs-edu > .rs-bullets{grid-column:1 / -1}
.rs-role-location:empty,.rs-role-company:empty,.rs-role-dates:empty,.rs-edu-details:empty,.rs-project-detail:empty,.rs-project-tech:empty{display:none}

.rs-project{margin-top:var(--rs-item-gap)}
.rs-project-name,.rs-project-detail{display:inline}
.rs-project-detail:not(:empty):not(.is-empty)::before{content:" - ";font-weight:400}
.rs-project-tech{font-style:italic}

.rs-skills{margin-top:calc(var(--rs-item-gap) * .35)}
.rs-section-title + .rs-skills{margin-top:0}
.rs-skills-label{font-weight:700}
.rs-skills-label::after{content:":"}
.rs-skills-items{margin-left:.35em}

.rs-bullets{list-style:disc;padding-left:1.25em;margin-top:2pt}
.rs-bullets .rs-bullets{list-style:circle;margin-top:0}
.rs-bullet{padding-left:.1em}
.rs-bullet > p{margin:0}

.rs-divider{border:0;border-top:1px solid #999;margin:var(--rs-item-gap) 0}
.rs-page > p + p,.rs-page > p + .rs-bullets,.rs-page > .rs-bullets + p{margin-top:.85em}
`;

/** The sheet of paper on screen: A4 with the page margins as padding. */
export const SHEET_CSS = `
.rs-sheet{width:210mm;min-height:297mm;padding:var(--rs-margin);box-shadow:0 0 0 1px rgba(0,0,0,.08),0 1px 3px rgba(0,0,0,.12),0 8px 24px rgba(0,0,0,.08)}
`;

/**
 * Print rules for the PDF. The margins are the printer margins (@page), so the second page has them too. The page
 * itself then has no padding. @page cannot read CSS variables, so the number is written in.
 */
export function printCss(settings: PageSettings): string {
  return `@page{size:A4;margin:${resolveMetrics(settings).marginMm}mm}
html,body{margin:0;padding:0;background:#fff}
.rs-page{width:auto;padding:0;orphans:1;widows:1}
`;
}
