import { describe, expect, it } from "vitest";
import { emailDocToHtml, emailDocToText, hasFormatting, normalizeEmailDoc, textToEmailDoc, trimEmailDoc, type EmailDoc } from "@/lib/outreach/body";
import { emailDocToLetter } from "@/lib/documents/sent-email";

const link = (href: string) => ({ type: "link" as const, attrs: { href } });
const doc = (...lines: EmailDoc["content"]): EmailDoc => ({ type: "doc", content: lines });
const PROPOSAL = "https://github.com/someone/project/blob/main/PROPOSALS.md";

/** "Hi Jane," / blank / "Read my **proposal** (linked)." / "Best," / "Sam" */
const formatted = doc(
  { type: "paragraph", content: [{ type: "text", text: "Hi Jane," }] },
  { type: "paragraph" },
  {
    type: "paragraph",
    content: [
      { type: "text", text: "Read " },
      { type: "text", text: "my ", marks: [link(PROPOSAL)] },
      { type: "text", text: "proposal", marks: [link(PROPOSAL), { type: "bold" }] },
      { type: "text", text: " & say <hi>", marks: [{ type: "italic" }, { type: "underline" }] },
    ],
  },
  { type: "paragraph", content: [{ type: "text", text: "Best," }] },
  { type: "paragraph", content: [{ type: "text", text: "Sam" }] },
);

describe("plain text and the email document", () => {
  it("keeps every line, blank ones included, and links web addresses", () => {
    const d = textToEmailDoc(`Hi,\n\nSee ${PROPOSAL}.\nBest,\nSam`);
    expect(d.content).toHaveLength(5);
    expect(d.content[1]).toEqual({ type: "paragraph" });
    expect(d.content[2].content).toEqual([
      { type: "text", text: "See " },
      { type: "text", text: PROPOSAL, marks: [link(PROPOSAL)] },
      { type: "text", text: "." },
    ]);
    // A link whose text is its own address reads back unchanged.
    expect(emailDocToText(d)).toBe(`Hi,\n\nSee ${PROPOSAL}.\nBest,\nSam`);
  });

  it("writes a named link as its text followed by the address, as Gmail does", () => {
    expect(emailDocToText(formatted)).toBe(`Hi Jane,\n\nRead my proposal <${PROPOSAL}> & say <hi>\nBest,\nSam`);
    const mail = doc({ type: "paragraph", content: [{ type: "text", text: "Email me", marks: [link("mailto:sam@x.com")] }] });
    expect(emailDocToText(mail)).toBe("Email me <sam@x.com>");
  });
});

describe("emailDocToHtml", () => {
  it("writes a div per line, keeps a link with bold inside as one link, and escapes the text", () => {
    expect(emailDocToHtml(formatted)).toBe(
      `<div dir="ltr"><div>Hi Jane,</div><div><br></div><div>Read <a href="${PROPOSAL}">my <b>proposal</b></a><i><u> &amp; say &lt;hi&gt;</u></i></div><div>Best,</div><div>Sam</div></div>`,
    );
  });
});

describe("normalizeEmailDoc", () => {
  it("keeps only what an email can hold", () => {
    const raw = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a", marks: [{ type: "bold" }, { type: "bold" }, { type: "strike" }] },
            { type: "text", text: "b", marks: [{ type: "bold" }] },
            { type: "text", text: "bad", marks: [link("javascript:alert(1)")] },
            { type: "text", text: "ok", marks: [{ type: "link", attrs: { href: "x.com", target: "_blank", rel: "noopener", class: null } }] },
            { type: "text", text: "" },
          ],
        },
        { type: "heading", content: [{ type: "text", text: "Line\nbreak" }] },
      ],
    };
    expect(normalizeEmailDoc(raw)).toEqual(
      doc(
        {
          type: "paragraph",
          content: [
            { type: "text", text: "ab", marks: [{ type: "bold" }] },
            { type: "text", text: "bad" },
            { type: "text", text: "ok", marks: [link("https://x.com")] },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "Line break" }] },
      ),
    );
  });

  it("turns anything that is not a document into one empty line", () => {
    expect(normalizeEmailDoc("<b>hi</b>")).toEqual(doc({ type: "paragraph" }));
    expect(normalizeEmailDoc({ type: "doc", content: [] })).toEqual(doc({ type: "paragraph" }));
  });
});

describe("helpers", () => {
  it("trims blank lines at the ends and tells formatted from plain", () => {
    const d = textToEmailDoc("\n\nHi\n\nBye\n\n");
    expect(emailDocToText(trimEmailDoc(d))).toBe("Hi\n\nBye");
    expect(hasFormatting(d)).toBe(false);
    expect(hasFormatting(formatted)).toBe(true);
  });

  it("files a formatted email in the library as spaced paragraphs with their formatting", () => {
    const letter = emailDocToLetter(formatted);
    expect(letter.content?.map((p) => p.content?.map((t) => t.text).join(""))).toEqual(["Hi Jane,", "Read my proposal & say <hi>", "Best,", "Sam"]);
    expect(letter.content?.[1].content?.[2]).toMatchObject({ text: "proposal", marks: [link(PROPOSAL), { type: "bold" }] });
  });
});
