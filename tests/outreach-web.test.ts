import { beforeEach, describe, expect, it, vi } from "vitest";
import { SearchError, type WebSearchProvider } from "@/lib/companies/search";

process.env.DATABASE_URL ??= "postgres://unused";
const chat = vi.fn();
vi.mock("@/lib/llm/structured", () => ({ chatStructured: (...args: unknown[]) => chat(...args) }));

const { findPeopleOnWeb } = await import("@/lib/outreach/web");
const { extractPostingPeople } = await import("@/lib/outreach/posting");

const target = { company: "Acme", jobTitle: "Data Engineer", domain: "acme.com" };
const results = [
  { title: "Priya Rao - Engineering Manager - Acme | LinkedIn", url: "https://linkedin.com/in/priya", content: "Manager" },
  { title: "Leadership", url: "https://acme.com/team", content: "Our team" },
];
const searcher = (r = results): WebSearchProvider => ({ search: vi.fn(async () => r) });

beforeEach(() => chat.mockReset());

describe("findPeopleOnWeb", () => {
  it("searches LinkedIn for managers and recruiters and the company site for leadership", async () => {
    const s = searcher();
    chat.mockResolvedValue({ people: [] });
    await findPeopleOnWeb(target, s);
    const calls = (s.search as ReturnType<typeof vi.fn>).mock.calls as [string, { includeDomains?: string[] }][];
    expect(calls).toHaveLength(3);
    expect(calls.filter(([, o]) => o.includeDomains?.[0] === "linkedin.com")).toHaveLength(2);
    expect(calls.some(([, o]) => o.includeDomains?.[0] === "acme.com")).toBe(true);
  });

  it("keeps only people with a full name who cite one of the results, and links LinkedIn profiles", async () => {
    chat.mockResolvedValue({
      people: [
        { name: "Priya Rao", title: "Engineering Manager", kind: "team_lead", sourceUrl: "https://linkedin.com/in/priya" },
        { name: "Priya Rao", title: "duplicate", kind: "team_lead", sourceUrl: "https://linkedin.com/in/priya" },
        { name: "Cher", title: "Singer", kind: "other", sourceUrl: "https://linkedin.com/in/priya" },
        { name: "Made Up", title: "CEO", kind: "founder", sourceUrl: "https://example.com/not-a-result" },
        { name: "Sam Lee", title: "Co-founder", kind: "founder", sourceUrl: "https://acme.com/team" },
      ],
    });
    const people = await findPeopleOnWeb(target, searcher());
    expect(people.map((p) => p.name)).toEqual(["Priya Rao", "Sam Lee"]);
    expect(people[0].linkedinUrl).toBe("https://linkedin.com/in/priya");
    expect(people[1].linkedinUrl).toBeNull();
  });

  it("returns nothing without calling the model when there are no results", async () => {
    expect(await findPeopleOnWeb(target, searcher([]))).toEqual([]);
    expect(chat).not.toHaveBeenCalled();
  });

  it("reports a search failure instead of hiding it", async () => {
    const failing: WebSearchProvider = { search: vi.fn(async () => { throw new SearchError("plan limit reached"); }) };
    await expect(findPeopleOnWeb(target, failing)).rejects.toThrow("plan limit reached");
  });
});

describe("extractPostingPeople", () => {
  it("skips the model for an empty posting", async () => {
    expect(await extractPostingPeople("   ")).toEqual([]);
    expect(chat).not.toHaveBeenCalled();
  });

  it("keeps named people, normalises emails and drops malformed ones", async () => {
    chat.mockResolvedValue({
      people: [
        { name: "Jane Doe", title: "Recruiter", email: "Jane.Doe@Acme.com", role: "recruiter", evidence: "email Jane" },
        { name: "Bob", title: "", email: "not-an-email", role: "other", evidence: "ask Bob" },
        { name: "X", title: "", email: "", role: "other", evidence: "" },
      ],
    });
    const people = await extractPostingPeople("posting text");
    expect(people).toEqual([
      { name: "Jane Doe", title: "Recruiter", email: "jane.doe@acme.com", kind: "recruiter", evidence: "email Jane" },
      { name: "Bob", title: "", email: null, kind: "other", evidence: "ask Bob" },
    ]);
  });
});
