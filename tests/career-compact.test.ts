// The model name is read from the environment, which needs a database URL to load; no database is used.
process.env.DATABASE_URL ??= "postgres://unused";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { makeClusterer, readGroups, type Clusterer } from "@/lib/career/cluster";
import { applyAnswers, cleanUp, compactRecord, mendBrackets } from "@/lib/career/compact";
import { makeDescriber, readDescription, type Describer } from "@/lib/career/describe";
import { checkStatement, conflictingMetrics, detailsFromWordings, fitSlots, newClaims, slotsOf, technologiesIn } from "@/lib/career/facts";
import { recordToMarkdown } from "@/lib/career/markdown";
import { textKey } from "@/lib/career/normalize";
import { recordForPrompt } from "@/lib/career/prompt";
import { upgradeRecord } from "@/lib/career/upgrade";
import { mergeProvenance, type CareerRecord, type Detail, type Wording } from "@/lib/career/schema";
import { numbersIn } from "@/lib/resume-writer/proof";
import { counter, employer, fact, recordWith, role, SOURCE_A, SOURCE_B } from "./career-helpers";

const detail = (id: string, kind: Detail["kind"], text: string, measures = ""): Detail => ({ id, kind, text, measures, sources: [], provenance: mergeProvenance() });
const wording = (id: string, text: string, framingId: string | null = null, source = SOURCE_A): Wording => ({
  id,
  text,
  framingId,
  form: "bullet",
  sources: [{ sourceId: source, blockId: null }],
  provenance: mergeProvenance(),
});

describe("what a point adds to a fact", () => {
  const f = fact("f1", [["w1", "Cut API latency by 40% with Redis caching"]]);
  it("is nothing when its numbers and names are all in the fact", () => {
    expect(newClaims("Reduced API latency 40% by adding Redis", f)).toEqual([]);
  });
  it("lists the numbers and names it brings", () => {
    expect(newClaims("Cut API latency by 40% across 12 services with Redis and Kafka", f)).toEqual(["12", "Kafka"]);
  });
});

describe("checkStatement", () => {
  const f = { wordings: [{ text: "Cut API latency by 40% with Redis caching for 2,000 merchants" }], details: [] };
  it("passes a statement that only uses what the wordings say", () => {
    expect(checkStatement("Cut API latency by 40% for 2,000 merchants with Redis caching", f)).toEqual([]);
  });
  it("names a number or a tool the wordings do not have", () => {
    expect(checkStatement("Cut API latency by 45% with Redis and Kafka", f)).toEqual(['"45" is not in any wording of this fact.', '"Kafka" is not in any wording of this fact.']);
  });
  it("rejects an empty or overlong statement", () => {
    expect(checkStatement("  ", f)).toEqual(["The statement is empty."]);
    expect(checkStatement("Cut API latency ".repeat(30), f)[0]).toMatch(/characters/);
  });
});

describe("details", () => {
  it("keeps only details a wording says, once each", () => {
    const got = detailsFromWordings(
      [
        { kind: "tool", text: "Redis" },
        { kind: "tool", text: "redis" },
        { kind: "tool", text: "Memcached" },
        { kind: "metric", text: "40%" },
      ],
      [{ text: "Cut API latency by 40% with Redis caching" }],
    );
    expect(got.map((d) => d.text)).toEqual(["Redis", "40%"]);
  });

  it("does not ask about a range and the change it gives", () => {
    expect(conflictingMetrics([detail("a", "metric", "time-to-first-value from 8 minutes to 1 minute", "time to value"), detail("b", "metric", "87% improvement", "time to value")])).toEqual([]);
    expect(conflictingMetrics([detail("a", "metric", "33% to 50%", "query time"), detail("b", "metric", "66.7%", "query time")])).toHaveLength(1);
    // A before and after that one wording gives together.
    const pair = [detail("a", "metric", "8 minutes", "time to value"), detail("b", "metric", "1 minute", "time to value")];
    expect(conflictingMetrics(pair, [{ text: "cut time to value from 8 minutes to 1 minute" }])).toEqual([]);
    expect(conflictingMetrics(pair)).toHaveLength(1);
  });

  it("finds two values for one measure", () => {
    const groups = conflictingMetrics([detail("a", "metric", "66.7%", "API response time"), detail("b", "metric", "150%", "api response time"), detail("c", "metric", "99.9% uptime", "uptime")]);
    expect(groups.map((g) => g.map((d) => d.id))).toEqual([["a", "b"]]);
  });
});

describe("fitSlots", () => {
  it("keeps the wording that carries the most of the fact per slot, and notes the others as seen", () => {
    const f = fact("f1", []);
    f.details = [detail("d1", "metric", "40%", "latency"), detail("d2", "tool", "Redis")];
    f.wordings = [wording("w1", "Made the API faster"), wording("w2", "Cut API latency by 40% with Redis", null, SOURCE_B), wording("w3", "Made the API faster for product", "fr2")];
    fitSlots(f);
    expect(f.wordings.map((w) => w.id)).toEqual(["w2", "w3"]);
    expect(f.seen).toEqual(["Made the API faster", "Cut API latency by 40% with Redis", "Made the API faster for product"].map(textKey));
    expect(f.sources.map((s) => s.sourceId).sort()).toEqual([SOURCE_A, SOURCE_B]);
  });

  it("shares one slot between framings with the same angle", () => {
    const f = fact("f1", []);
    f.wordings = [wording("w1", "Owned the roadmap", "pm"), wording("w2", "Owned the roadmap for 3 teams", "po"), wording("w3", "Built the API", "eng")];
    fitSlots(f, slotsOf([{ id: "pm", angle: "Product" }, { id: "po", angle: "product" }, { id: "eng", angle: "Engineering" }]));
    expect(f.wordings.map((w) => w.id)).toEqual(["w2", "w3"]);
  });

  it("never folds away a wording the user wrote or edited", () => {
    const f = fact("f1", []);
    const mine = { ...wording("w1", "Made it faster"), provenance: { origin: "merge" as const, user: ["text"] } };
    f.wordings = [mine, wording("w2", "Cut API latency by 40% with Redis")];
    fitSlots(f);
    expect(f.wordings.map((w) => w.id)).toEqual(["w1", "w2"]);
  });
});

describe("technologiesIn", () => {
  it("reads a technologies line, keeping brackets whole", () => {
    expect(technologiesIn("Technologies: Python, AWS (EC2, S3), Docker.")).toEqual(["Python", "AWS (EC2, S3)", "Docker"]);
    expect(technologiesIn("Built Python services")).toBeNull();
    expect(technologiesIn("Technologies: Technologies: Python, Go, Python")).toEqual(["Python", "Go"]);
  });
});

describe("upgradeRecord", () => {
  it("gives schema 1 facts sources and seen texts from their wordings, and roles no technologies", () => {
    const old = recordWith(employer("Acme", [role({ facts: [fact("f1", [["w1", "Built billing"], ["w2", "Shipped billing", ["b2"]]])] })]));
    const loose = JSON.parse(JSON.stringify(old));
    for (const k of ["statement", "details", "sources", "seen"]) delete loose.employers[0].roles[0].facts[0][k];
    delete loose.employers[0].roles[0].technologies;
    const up = upgradeRecord(loose, 1);
    const f = up.employers[0].roles[0].facts[0];
    expect(f.statement).toBe("");
    expect(f.details).toEqual([]);
    expect(f.sources).toEqual([{ sourceId: SOURCE_A, blockId: null }, { sourceId: SOURCE_A, blockId: "b2" }]);
    expect(f.seen).toEqual([textKey("Built billing"), textKey("Shipped billing")]);
    expect(up.employers[0].roles[0].technologies).toEqual([]);
  });

  it("leaves a current record alone", () => {
    const r = recordWith();
    expect(upgradeRecord(r, 2)).toBe(r);
  });
});

/** A synthetic record with the repeats a long-lived record collects. */
function messy(): CareerRecord {
  const r = recordWith(
    employer("Acme", [
      role({
        facts: [
          fact("f1", [["w1", "Cut API response time by 66.7% by moving to FastAPI and Kafka"], ["w1b", "Cut API response time by 66.7% by moving to FastAPI and Kafka."]]),
          fact("f2", [["w2", "Improved API response time by 150% with a Kafka event backbone"]]),
          fact("f3", [["w3", "Ran bi-weekly interviews with 25+ customers"]]),
          fact("f4", [["w4", "Technologies: Python, FastAPI, AWS (EC2, S3)"]]),
        ],
      }),
    ]),
  );
  const tracked = { sources: [{ sourceId: SOURCE_A, blockId: null }], provenance: mergeProvenance() };
  r.skills = [
    { id: "s1", name: "Python", category: "Languages", ...tracked },
    { id: "s2", name: "LLM APIs", category: "AI", ...tracked },
    { id: "s3", name: "LLM APIs", category: "AI", ...tracked },
    { id: "s4", name: "LLM APIs, Prompt Engineering", category: "AI", ...tracked },
  ];
  r.education = [
    { id: "e1", institution: "North Point School", degree: "ICSE Board", field: "", start: "", end: "2018", details: "", ...tracked },
    { id: "e2", institution: "North Point School, India", degree: "ICSE Board", field: "", start: "", end: "2018", details: "", ...tracked },
  ];
  r.projects = [
    {
      id: "p1",
      name: "Ledger",
      description: "",
      url: "",
      technologies: [],
      wordings: [wording("pw1", "Built a ledger in Go"), wording("pw2", "Built a double-entry ledger in Go with 99.9% uptime"), wording("pw3", "Wrote the docs")],
      seen: [],
      ...tracked,
    },
  ];
  return r;
}

/** Joins the two API facts and the two ledger bullets, as a model would. */
const fakeCluster: Clusterer = async (items) => {
  const keys = items.map((i) => i.key);
  if (keys.includes("f1")) return [["f1", "f2"]];
  if (keys.includes("pw1")) return [["pw1", "pw2", "pw3"]];
  return [];
};

/** Statement: the first wording; details: each percentage as a metric of what it says it measures, and Kafka. */
const fakeDescribe: Describer = async (facts) =>
  new Map(
    facts.map((f) => {
      const details = f.wordings.flatMap((w) => [
        ...[...w.matchAll(/\d+(?:\.\d+)?%/g)].map((m) => ({ kind: "metric" as const, text: m[0], measures: /response time/i.test(w) ? "API response time" : "" })),
        ...(w.includes("Kafka") ? [{ kind: "tool" as const, text: "Kafka", measures: "" }] : []),
      ]);
      return [f.key, readDescription({ statement: f.wordings[0], details }, f.wordings)];
    }),
  );

describe("cleanUp", () => {
  it("takes out repeats, and moves technologies lines to the role and to skills", () => {
    const r = messy();
    const out = cleanUp(r, counter("k"));
    expect(out).toEqual({ skills: { before: 4, after: 5 }, education: { before: 2, after: 1 }, certifications: { before: 0, after: 0 }, achievements: { before: 0, after: 0 }, technologyLines: 1 });
    const acme = r.employers[0].roles[0];
    expect(acme.technologies).toEqual(["Python", "FastAPI", "AWS (EC2, S3)"]);
    expect(acme.facts.map((f) => f.id)).toEqual(["f1", "f2", "f3"]);
    expect(acme.facts[0].wordings.map((w) => w.id)).toEqual(["w1"]);
    expect(r.skills.map((s) => s.name)).toEqual(["Python", "LLM APIs", "Prompt Engineering", "FastAPI", "AWS (EC2, S3)"]);
    expect(r.skills.find((s) => s.name === "FastAPI")?.category).toBe("Technologies");
  });
});

describe("mendBrackets", () => {
  it("joins skills split inside brackets, and leaves a bracket that never closes alone", () => {
    const s = (name: string, category = "AI") => ({ name, category, sources: [] });
    const out = mendBrackets([s("LLM APIs (OpenAI"), s("Anthropic"), s("Ollama)"), s("RAG"), s("AWS (EC2"), s("S3", "Cloud")]);
    expect(out.map((x) => x.name)).toEqual(["LLM APIs (OpenAI, Anthropic, Ollama)", "RAG", "AWS (EC2", "S3"]);
  });
});

describe("compactRecord", () => {
  it("joins repeated facts, writes statements and details, fits slots and asks about numbers that disagree", async () => {
    const before = messy();
    const result = await compactRecord({ version: 7, record: before }, { cluster: fakeCluster, describe: fakeDescribe, newId: counter("d") });
    const acme = result.record.employers[0].roles[0];

    expect(result.baseVersion).toBe(7);
    expect(acme.facts.map((f) => f.id)).toEqual(["f1", "f3"]);
    expect(acme.facts[0].statement).toBe("Cut API response time by 66.7% by moving to FastAPI and Kafka");
    expect(acme.facts[0].details.map((d) => d.text)).toEqual(["66.7%", "Kafka", "150%"]);
    expect(result.roles).toEqual([{ id: "role1", label: "Acme, Engineer", factsBefore: 4, factsAfter: 2, wordingsBefore: 5, wordingsAfter: 2 }]);
    expect(result.questions).toEqual([
      expect.objectContaining({ factId: "f1", measures: "API response time", options: [expect.objectContaining({ text: "66.7%" }), expect.objectContaining({ text: "150%" })] }),
    ]);
    // The model grouped all three, but "Wrote the docs" says something the kept bullet does not, so it stays.
    expect(result.projects).toEqual([{ id: "p1", label: "Ledger", factsBefore: 3, factsAfter: 2, wordingsBefore: 3, wordingsAfter: 2 }]);
    expect(result.record.projects[0].wordings.map((w) => w.id)).toEqual(["pw2", "pw3"]);
    expect(result.record.projects[0].seen).toContain(textKey("Built a ledger in Go"));
    expect(result.size.after).toBeLessThan(result.size.before);
    // The record handed in is not changed.
    expect(before.employers[0].roles[0].facts).toHaveLength(4);
  });

  it("keeps every number of the old wordings in the record", async () => {
    const before = messy();
    const result = await compactRecord({ version: 1, record: before }, { cluster: fakeCluster, describe: fakeDescribe, newId: counter("d") });
    const said = (r: CareerRecord) => new Set(r.employers.flatMap((e) => e.roles.flatMap((x) => x.facts.flatMap((f) => [...f.wordings.map((w) => w.text), ...f.details.map((d) => d.text)]))).flatMap(numbersIn));
    const kept = said(result.record);
    for (const n of said(before)) {
      // Numbers of the technologies line moved to the role ("EC2"), the rest stay in a wording or a detail.
      if (n === "2" || n === "3") continue;
      expect(kept.has(n), n).toBe(true);
    }
  });

  it("leaves a statement unwritten when it fails its check, and keeps the user's own", async () => {
    const r = messy();
    r.employers[0].roles[0].facts[2].statement = "My own words";
    r.employers[0].roles[0].facts[2].provenance.user.push("statement");
    const lying: Describer = async (facts) => new Map(facts.map((f) => [f.key, readDescription({ statement: "Grew revenue by 300%", details: [] }, f.wordings)]));
    const result = await compactRecord({ version: 1, record: r }, { cluster: async () => [], describe: lying, newId: counter("d") });
    const facts = result.record.employers[0].roles[0].facts;
    expect(facts[0].statement).toBe("");
    expect(facts[2].statement).toBe("My own words");
    expect(result.unwritten.map((u) => u.factId)).toEqual(["f1", "f2"]);
  });
});

describe("applyAnswers", () => {
  it("keeps the chosen value, drops the other from details and wordings, and remembers it as removed", async () => {
    const result = await compactRecord({ version: 1, record: messy() }, { cluster: fakeCluster, describe: fakeDescribe, newId: counter("d") });
    const q = result.questions[0];
    const keep = q.options.find((o) => o.text === "66.7%")!.detailId;
    const record = applyAnswers(result, { [q.id]: keep }, new Date("2026-10-28T00:00:00Z"));
    const f = record.employers[0].roles[0].facts[0];
    expect(f.details.map((d) => d.text)).toEqual(["66.7%", "Kafka"]);
    expect(f.wordings.every((w) => !w.text.includes("150%"))).toBe(true);
    expect(record.removed).toContainEqual({ kind: "detail", key: "150", at: "2026-10-28T00:00:00.000Z" });
  });

  it("changes nothing for a question left unanswered", async () => {
    const result = await compactRecord({ version: 1, record: messy() }, { cluster: fakeCluster, describe: fakeDescribe, newId: counter("d") });
    expect(applyAnswers(result, {})).toEqual(result.record);
  });
});

describe("recordForPrompt", () => {
  it("is the same bytes for the same record, with statements, details and no ids", async () => {
    const result = await compactRecord({ version: 1, record: messy() }, { cluster: fakeCluster, describe: fakeDescribe, newId: counter("d") });
    const a = recordForPrompt(result.record);
    expect(recordForPrompt(structuredClone(result.record))).toBe(a);
    expect(a).toContain("- Cut API response time by 66.7% by moving to FastAPI and Kafka\n  Details: 66.7% (API response time); Kafka; 150% (API response time)");
    expect(a).toContain("Technologies: Python, FastAPI, AWS (EC2, S3)");
    expect(a).not.toContain("f1");
    expect(a.length).toBeLessThan(recordToMarkdown(messy(), { version: null, exportedOn: "" }).length);
  });
});

describe("the Markdown export of a tidied record", () => {
  it("leads each fact with its statement, then its details and the wordings kept", async () => {
    const result = await compactRecord({ version: 1, record: messy() }, { cluster: fakeCluster, describe: fakeDescribe, newId: counter("d") });
    const md = recordToMarkdown(result.record, { version: 2, exportedOn: "2026-10-28" });
    expect(md).toContain("Technologies: Python, FastAPI, AWS (EC2, S3)");
    expect(md).toContain("- Cut API response time by 66.7% by moving to FastAPI and Kafka\n  - Details: 66.7%; Kafka; 150%\n  - Worded: ");
    expect(md).not.toContain("Also worded");
  });
});

describe("the model steps", () => {
  it("cluster: sends aliases and text with the record first, and reads groups of ids only", async () => {
    const chat = vi.fn().mockResolvedValue({ groups: [["i1", "i3"], ["i3", "i2"], ["i9"]] });
    const groups = await makeClusterer(chat)([{ key: "a", text: "One" }, { key: "b", text: "Two" }, { key: "c", text: "Three" }], "PREFIX", "facts");
    expect(groups).toEqual([["a", "c"]]);
    const [schema, input, opts] = chat.mock.calls[0];
    expect(input.user).toContain('The facts of one role:\ni1: "One"');
    expect(input.user).not.toContain("a:");
    expect(opts).toMatchObject({ step: "cluster-facts", prefix: "PREFIX" });
    expect((schema as z.ZodType).safeParse({ groups: [["i4"]] }).success).toBe(false);
  });

  it("cluster: keeps the first group an item is in", () => {
    const items = [{ key: "a", text: "" }, { key: "b", text: "" }, { key: "c", text: "" }];
    expect(readGroups([["i2", "i1"], ["i1", "i3"], ["i2", "i3"]], items)).toEqual([["a", "b"]]);
  });

  it("describe: checks details and statements, and asks once more for a statement that failed", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce({ facts: [{ fact: "f1", statement: "Cut latency by 45% with Kafka", details: [{ kind: "metric", text: "40%", measures: "latency" }, { kind: "tool", text: "Kafka", measures: "" }] }] })
      .mockResolvedValueOnce({ facts: [{ fact: "f1", statement: "Cut latency by 40% with Redis", details: [{ kind: "metric", text: "40%", measures: "latency" }] }] });
    const out = await makeDescriber(chat)([{ key: "x", wordings: ["Cut latency by 40% with Redis"] }], "PREFIX");
    expect(out.get("x")).toEqual({ statement: "Cut latency by 40% with Redis", details: [{ kind: "metric", text: "40%", measures: "latency" }], findings: [] });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[1][1].user).toContain('"45" is not in any wording of this fact.');
    expect(chat.mock.calls[0][2]).toMatchObject({ step: "describe-facts", prefix: "PREFIX" });
  });

  it("describe: sends facts in batches", async () => {
    const chat = vi.fn(async (_s: unknown, input: { user: string }) => ({
      facts: [...input.user.matchAll(/^f(\d+):/gm)].map((m) => ({ fact: `f${m[1]}`, statement: "Did a thing", details: [] })),
    }));
    const facts = Array.from({ length: 8 }, (_, i) => ({ key: `k${i}`, wordings: ["Did a thing"] }));
    const out = await makeDescriber(chat as never)(facts, "P");
    expect(out.size).toBe(8);
    expect(chat).toHaveBeenCalledTimes(2);
  });
});

describe("details from the model", () => {
  it("drops a team or specific that is a whole clause, and keeps at most 16, metrics first", () => {
    const wording = `Cut costs by 1% 2% 3% 4% 5% 6% 7% 8% 9% 10% 11% 12% 13% 14% 15% 16% 17% with Redis, building ${"a very long internal platform for many teams across the company ".repeat(2)}`;
    const d = readDescription(
      {
        statement: "Cut costs by 1% with Redis",
        details: [
          { kind: "specific", text: `building ${"a very long internal platform for many teams across the company ".repeat(2)}`.trim(), measures: "" },
          { kind: "tool", text: "Redis", measures: "" },
          ...Array.from({ length: 17 }, (_, i) => ({ kind: "metric" as const, text: `${i + 1}%`, measures: "cost" })),
        ],
      },
      [wording],
    );
    expect(d.details).toHaveLength(16);
    expect(d.details.every((x) => x.kind === "metric")).toBe(true);
  });
});
