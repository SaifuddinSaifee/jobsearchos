import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  ColdEmailSettingsSchema,
  defaultColdEmailSettings,
  getColdEmailSettings,
  saveColdEmailSettings,
} from "@/lib/email/settings";
import { resetDb, testDb } from "./helpers";

const db = testDb();

beforeEach(() => resetDb(db));
afterAll(() => db.$client.end());

describe("cold email settings", () => {
  it("returns the documented defaults when nothing is saved", async () => {
    const s = await getColdEmailSettings(db);
    expect(s).toEqual(defaultColdEmailSettings());
    expect(s.dailyCap).toBe(25);
    expect(s.sendDays).toEqual(["tue", "wed", "thu"]);
    expect([s.minWords, s.maxWords, s.followUpMaxWords]).toEqual([60, 120, 50]);
  });

  it("saves, overwrites and loads back", async () => {
    await saveColdEmailSettings({ ...defaultColdEmailSettings(), dailyCap: 10, senderName: "Sam Lee" }, db);
    await saveColdEmailSettings(
      { ...defaultColdEmailSettings(), dailyCap: 12, links: [{ label: "GitHub", url: "https://github.com/sam" }] },
      db,
    );
    const s = await getColdEmailSettings(db);
    expect(s.dailyCap).toBe(12);
    expect(s.senderName).toBe("");
    expect(s.links).toHaveLength(1);
  });

  it("fills in fields missing from an older saved row", async () => {
    const { appSettings } = await import("@/lib/db/schema");
    const old: Partial<ReturnType<typeof defaultColdEmailSettings>> = defaultColdEmailSettings();
    delete old.dailyCap;
    await db.insert(appSettings).values({ id: "default", coldEmail: old as never });
    expect((await getColdEmailSettings(db)).dailyCap).toBe(25);
  });

  describe("validation", () => {
    const parse = (patch: object) => ColdEmailSettingsSchema.safeParse({ ...defaultColdEmailSettings(), ...patch });

    it("rejects a maximum below the minimum", () => {
      expect(parse({ minWords: 100, maxWords: 80 }).success).toBe(false);
    });

    it("allows at most two follow-ups", () => {
      expect(parse({ maxFollowUps: 3 }).success).toBe(false);
      expect(parse({ maxFollowUps: 2 }).success).toBe(true);
    });

    it("allows at most two links, and they must be URLs", () => {
      const link = (n: number) => ({ label: `L${n}`, url: `https://example.com/${n}` });
      expect(parse({ links: [link(1), link(2), link(3)] }).success).toBe(false);
      expect(parse({ links: [{ label: "x", url: "not a url" }] }).success).toBe(false);
    });

    it("needs at least one send day and a window that ends after it starts", () => {
      expect(parse({ sendDays: [] }).success).toBe(false);
      expect(parse({ sendWindowStart: "11:00", sendWindowEnd: "09:00" }).success).toBe(false);
      expect(parse({ sendWindowStart: "9am" }).success).toBe(false);
    });

    it("rejects saving invalid values", async () => {
      await expect(saveColdEmailSettings({ ...defaultColdEmailSettings(), dailyCap: 0 }, db)).rejects.toThrow();
    });
  });
});
