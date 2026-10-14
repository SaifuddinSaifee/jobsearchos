import { describe, expect, it } from "vitest";
import { acceptAll, allKeys, setRoleBullets, updateDecision } from "@/lib/career/decisions";
import { buildProposal } from "@/lib/career/proposal";
import type { Decisions } from "@/lib/career/proposal-schema";
import { extractFromProfile } from "@/lib/career/extract";
import { emptyRecord } from "@/lib/career/schema";
import { profileWith, SOURCE_A } from "./career-helpers";

describe("updateDecision", () => {
  it("leaving an item out and putting it back removes the entry", () => {
    const out = updateDecision({}, "k", { include: false });
    expect(out.k).toMatchObject({ action: "reject" });
    expect(updateDecision(out, "k", { include: true })).toEqual({ k: { action: "accept" } });
  });

  it("a change makes the decision a change and keeps the item included", () => {
    const out = updateDecision({}, "k", { role: { to: "new" } });
    expect(out.k).toEqual({ action: "change", role: { to: "new" } });
  });

  it("keeps earlier changes when the item is left out and put back", () => {
    let d = updateDecision({}, "k", { angle: "Growth" });
    d = updateDecision(d, "k", { include: false });
    expect(d.k).toEqual({ action: "reject", angle: "Growth" });
    d = updateDecision(d, "k", { include: true });
    expect(d.k).toEqual({ action: "change", angle: "Growth" });
  });

  it("a change on an item that was left out keeps it left out", () => {
    let d = updateDecision({}, "k", { include: false });
    d = updateDecision(d, "k", { role: { to: "new" } });
    expect(d.k.action).toBe("reject");
  });

  it("does not change the decisions it was given", () => {
    const before = {};
    updateDecision(before, "k", { include: false });
    expect(before).toEqual({});
  });
});

describe("whole proposals", () => {
  const proposal = buildProposal(
    { version: 0, record: emptyRecord() },
    extractFromProfile(profileWith([{ bullets: ["One", "Two"] }])),
    { sourceId: SOURCE_A, label: "A", targetRole: null },
  );

  it("lists every key once", () => {
    const keys = allKeys(proposal);
    expect(keys).toHaveLength(4);
    expect(new Set(keys).size).toBe(4);
  });

  it("includes everything, also what was removed before", () => {
    const keys = allKeys(proposal);
    const left = keys.reduce<Decisions>((acc, k) => updateDecision(acc, k, { include: false }), {});
    expect(Object.values(left).every((d) => d.action === "reject")).toBe(true);
    expect(acceptAll(left, proposal)).toEqual(Object.fromEntries(keys.map((k) => [k, { action: "accept" }])));
  });

  it("leaves out only the bullets of one role", () => {
    const role = proposal.employers[0].roles[0];
    const out = setRoleBullets({}, proposal, role.key, false);
    expect(Object.keys(out).sort()).toEqual(role.bullets.map((b) => b.key).sort());
  });
});
