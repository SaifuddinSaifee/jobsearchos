import { describe, expect, it } from "vitest";
import type { DocJSON } from "@/lib/documents/build";
import { contactPieces, docToProfile } from "@/lib/documents/convert/doc-to-profile";
import { profileToDoc } from "@/lib/documents/convert/profile-to-doc";
import { emptyProfile } from "@/lib/profile/schema";

const text = (t: string, href?: string): DocJSON => ({ type: "text", text: t, ...(href ? { marks: [{ type: "link", attrs: { href } }] } : {}) });

/** A header the way an uploaded resume often has it: links shown as labels, the address only in the link. */
const header = (contact: DocJSON[]): DocJSON => ({
  type: "doc",
  content: [{ type: "header", content: [{ type: "headerName", content: [text("Sam Example")] }, { type: "headerContact", content: contact }] }],
});

describe("reading the contact line", () => {
  const line = [
    text("sam@example.com", "mailto:sam@example.com"),
    text(" | +1 555 0100 | "),
    text("LinkedIn", "https://www.linkedin.com/in/samexample"),
    text(" | "),
    text("GitHub", "https://github.com/samexample"),
  ];

  it("keeps the address of a link shown as a label", () => {
    expect(contactPieces({ type: "headerContact", content: line })).toEqual([
      { text: "sam@example.com", href: "mailto:sam@example.com" },
      { text: "+1 555 0100", href: null },
      { text: "LinkedIn", href: "https://www.linkedin.com/in/samexample" },
      { text: "GitHub", href: "https://github.com/samexample" },
    ]);
  });

  it("puts the addresses in the profile, not the labels, and never takes a label for a location", () => {
    expect(docToProfile(header(line)).contact).toEqual({
      name: "Sam Example",
      email: "sam@example.com",
      phone: "+1 555 0100",
      location: "",
      links: ["https://www.linkedin.com/in/samexample", "https://github.com/samexample"],
    });
  });

  it("reads back what profileToDoc writes, an address shown as text kept as shown", () => {
    const p = emptyProfile();
    p.contact = { name: "Sam Example", email: "sam@example.com", phone: "555 0100", location: "Austin, TX", links: ["https://github.com/samexample"] };
    expect(docToProfile(profileToDoc(p)).contact).toEqual({ ...p.contact, links: ["github.com/samexample"] });
  });
});
