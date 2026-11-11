import { describe, expect, it } from "vitest";
import { composeSkills, isNamed, MAX_SKILLS_PER_LINE, SKILLS_TARGET, skillWanted } from "@/lib/resume-writer/skills";

const skill = (category: string, ...names: string[]) => names.map((name) => ({ name, category }));

/** A record's skills the way they arrive from several documents: split lists, repeats, catch-alls and a product area. */
const messy = [
  ...skill("AI & Automation", "LLM APIs (OpenAI", "Anthropic", "Ollama)", "AI Agents", "RAG", "LangChain", "Claude Code", "Claude", "LLM APIs (OpenAI, Anthropic, Ollama)", "MCP", "Model Context Protocol (MCP)"),
  ...skill("Cloud & DevOps", "AWS (EC2", "Lambda)", "Docker", "Kubernetes", "AWS (EC2, S3, Lambda)", "Git/GitHub"),
  ...skill("Frameworks & Libraries", "Next.js", "React.js", "Django", "FastAPI"),
  ...skill("Frameworks", "Rails"),
  ...skill("Programming Languages", "Python", "TypeScript/JavaScript", "JavaScript/TypeScript", "Go", "SQL"),
  ...skill("Technologies", "AWS", "React", "Mixpanel", "LogRocket", "GitHub"),
  ...skill("Skills", "Agile", "User research"),
  ...skill("Development Practices", "Agile/Scrum", "API Development", "System Design", "Code Review"),
  ...skill("Product & Media", "Video streaming", "Realtime voice agents"),
  ...skill("Interests", "reading", "games"),
];
const terms = ["Rails", "React", "TypeScript", "Claude Code", "MCP", "Video streaming", "Realtime voice agents", "Product analytics"];
const wanted = skillWanted(terms, ["Strong across the full stack - an expert in both exposing APIs and the frontend", "Shipped LLM-powered features"]);
const lines = composeSkills(messy, wanted, ["Rails", "Agentic search"]);
const items = lines.flatMap((l) => l.items);
const lineOf = (name: string) => lines.find((l) => l.items.includes(name))?.category;

describe("composeSkills", () => {
  it("keeps whole skills only, each once, and none a longer one already says", () => {
    expect(items).not.toEqual(expect.arrayContaining(["LLM APIs (OpenAI"]));
    expect(items.filter((i) => /Ollama\)$/.test(i) && !i.includes("("))).toEqual([]);
    expect(items).toContain("LLM APIs (OpenAI, Anthropic, Ollama)");
    // "Claude" is said by "Claude Code", "MCP" by its long form, "AWS" by "AWS (EC2, S3, Lambda)".
    expect(items).not.toContain("Claude");
    expect(items).not.toContain("MCP");
    expect(items).not.toContain("AWS");
    expect(items.filter((i) => /TypeScript/.test(i))).toEqual(["TypeScript/JavaScript"]);
  });

  it("uses the candidate's own categories: a short name joins its longer one, a catch-all gives its skills away", () => {
    expect(lineOf("Rails")).toBe("Frameworks & Libraries");
    expect(lines.map((l) => l.category)).not.toContain("Frameworks");
    // "AWS" and "React" from "Technologies" went to the categories that already name them, and were then covered there.
    expect(lineOf("React.js")).toBe("Frameworks & Libraries");
    expect(lineOf("Agile/Scrum")).toBe("Development Practices");
    // What fits nowhere stays together under the catch-all's own name, last.
    expect(lines.at(-1)?.category).toBe("Technologies");
    expect(lineOf("Mixpanel")).toBe("Technologies");
    expect(lines.map((l) => l.category)).not.toContain("Skills");
  });

  it("leaves out interests and product areas", () => {
    expect(lines.map((l) => l.category)).not.toContain("Interests");
    expect(lines.map((l) => l.category)).not.toContain("Product & Media");
    expect(items).not.toContain("Video streaming");
    expect(items).not.toContain("Realtime voice agents");
  });

  it("puts the job's skills first in each line, and the line with the most of them first", () => {
    expect(lines[0].category).toBe("AI & Automation");
    expect(lines[0].items.slice(0, 2)).toEqual(["Claude Code", "Model Context Protocol (MCP)"]);
    const frameworks = lines.find((l) => l.category === "Frameworks & Libraries")!;
    expect(frameworks.items.slice(0, 2)).toEqual(["React.js", "Rails"]);
  });

  it("adds what the user said they have next to the skills it is like", () => {
    expect(items).toContain("Agentic search");
    expect(items.filter((i) => i === "Rails")).toHaveLength(1);
  });

  it("lists about a resume's worth, never too many on a line", () => {
    const many = composeSkills(Array.from({ length: 80 }, (_, i) => ({ name: `Tool${i}`, category: `Group${i % 4}` })), () => false);
    expect(many.reduce((n, l) => n + l.items.length, 0)).toBe(SKILLS_TARGET);
    expect(Math.max(...many.map((l) => l.items.length))).toBeLessThanOrEqual(MAX_SKILLS_PER_LINE);
    // Every skill the job asks for is listed, whatever the target.
    const asked = composeSkills(Array.from({ length: 50 }, (_, i) => ({ name: `Tool${i}`, category: `Group${i % 5}` })), () => true);
    expect(asked.reduce((n, l) => n + l.items.length, 0)).toBe(50);
  });

  it("keeps small categories as they are when there is nothing bigger", () => {
    expect(composeSkills([...skill("Databases", "SQL"), ...skill("Design", "Figma")], () => false)).toEqual([
      { category: "Databases", items: ["SQL"] },
      { category: "Design", items: ["Figma"] },
    ]);
    expect(composeSkills([], () => true, ["Kafka"])).toEqual([{ category: "Skills", items: ["Kafka"] }]);
  });
});

describe("skillWanted", () => {
  it("matches the job's terms and skills its requirements name, but never a short name inside a word", () => {
    const asks = skillWanted(["TypeScript", "Go"], ["Built go-to-market tools", "Experience with Kafka"]);
    expect(asks("TypeScript/JavaScript")).toBe(true);
    expect(asks("Kafka")).toBe(true);
    expect(asks("Go")).toBe(true);
    expect(skillWanted([], ["Built go-to-market tools"])("Go")).toBe(false);
    expect(asks("Figma")).toBe(false);
  });
});

describe("isNamed", () => {
  it("tells a tool's name from a product area", () => {
    expect(["Rails", "Claude Code", "MCP", "n8n", "Next.js", "TypeScript/JavaScript"].map(isNamed)).toEqual([true, true, true, true, true, true]);
    expect(["Video streaming", "Realtime voice agents", "Agentic search"].map(isNamed)).toEqual([false, false, false]);
  });
});
