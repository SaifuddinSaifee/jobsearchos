import { afterEach, describe, expect, it, vi } from "vitest";
import { accountInfo, enrichPerson, functionTerm, normalizeDomain, ProspeoError, searchPeople, searchTitles } from "@/lib/outreach/prospeo";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const request = (mock: ReturnType<typeof vi.fn>, n = 0) => {
  const [url, init] = mock.mock.calls[n] as unknown as [string, RequestInit];
  return { url, init, body: init.body ? JSON.parse(init.body as string) : null, headers: init.headers as Record<string, string> };
};

afterEach(() => vi.unstubAllGlobals());

describe("normalizeDomain", () => {
  it("reduces websites to a bare domain", () => {
    expect(normalizeDomain("https://www.Acme.com/careers?x=1")).toBe("acme.com");
    expect(normalizeDomain("acme.com")).toBe("acme.com");
    expect(normalizeDomain("jobs.acme.co.uk")).toBe("jobs.acme.co.uk");
  });
  it("rejects empty or unusable values", () => {
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain("not a url at all")).toBeNull();
  });
});

describe("functionTerm and searchTitles", () => {
  it("turns a job title into the function it belongs to", () => {
    expect(functionTerm("Senior Data Engineer")).toBe("data engineering");
    expect(functionTerm("Founding Engineer")).toBe("engineering");
    expect(functionTerm("Staff Software Engineer, Payments")).toBe("software engineering payments");
    expect(functionTerm("Product Designer II")).toBe("product designer");
    expect(functionTerm("Developer Advocate")).toBe("developer advocate");
    expect(functionTerm("")).toBe("engineering");
  });

  it("aims the title search at the hiring chain, then recruiters and founders", () => {
    expect(searchTitles("Senior Data Engineer")).toEqual([
      "head of data engineering",
      "director of data engineering",
      "data engineering manager",
      "vp of data engineering",
      "recruiter",
      "talent acquisition",
      "founder",
      "ceo",
    ]);
  });
});

describe("searchPeople", () => {
  const result = (over: object = {}) => ({
    person: { person_id: "p1", first_name: "Priya", last_name: "Rao", full_name: "Priya Rao", current_job_title: "Head of Data", linkedin_url: "https://www.linkedin.com/in/priya", ...over },
    company: { name: "Acme" },
  });

  it("sends the key as a header and filters by company website and job title", async () => {
    const fetchMock = vi.fn(async () => json({ error: false, results: [result()] }));
    vi.stubGlobal("fetch", fetchMock);
    const people = await searchPeople({ domain: "acme.com", company: "Acme", titles: ["recruiter"] }, "secret-key");
    const r = request(fetchMock);
    expect(r.url).toBe("https://api.prospeo.io/search-person");
    expect(r.init.method).toBe("POST");
    expect(r.headers["X-KEY"]).toBe("secret-key");
    expect(r.url).not.toContain("secret-key");
    expect(r.body).toEqual({
      page: 1,
      filters: { person_job_title: { include: ["recruiter"], match_mode: "CONTAINS" }, company: { websites: { include: ["acme.com"] } } },
    });
    expect(people).toEqual([
      { personId: "p1", firstName: "Priya", lastName: "Rao", fullName: "Priya Rao", title: "Head of Data", linkedinUrl: "https://www.linkedin.com/in/priya" },
    ]);
  });

  it("falls back to the company name when there is no domain", async () => {
    const fetchMock = vi.fn(async () => json({ error: false, results: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await searchPeople({ company: "Acme Inc", titles: ["ceo"] }, "k");
    expect(request(fetchMock).body.filters.company).toEqual({ names: { include: ["Acme Inc"] } });
  });

  it("skips results without an id or name, and treats no results as an empty list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: false, results: [result({ person_id: "" }), result({ full_name: "", first_name: "" }), result({ person_id: "p2" })] })));
    expect((await searchPeople({ company: "A", titles: ["x"] }, "k")).map((p) => p.personId)).toEqual(["p2"]);
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: true, error_code: "NO_RESULTS" }, 400)));
    expect(await searchPeople({ company: "A", titles: ["x"] }, "k")).toEqual([]);
  });

  it("turns Prospeo's errors into messages that say what to do", async () => {
    const ask = (body: object, status = 400) => {
      vi.stubGlobal("fetch", vi.fn(async () => json(body, status)));
      return searchPeople({ company: "A", titles: ["x"] }, "k");
    };
    await expect(ask({ error: true, error_code: "INVALID_API_KEY" })).rejects.toThrow(/PROSPEO_API_KEY/);
    await expect(ask({ error: true, error_code: "INSUFFICIENT_CREDITS" })).rejects.toThrow(/credits are used up/);
    await expect(ask({}, 429)).rejects.toThrow(/rate limit/);
    await expect(ask({ error: true, error_code: "INVALID_FILTERS", filter_error: "bad title" })).rejects.toThrow(/INVALID_FILTERS: bad title/);
    await expect(ask({ error: true, error_code: "SERVICE_TEMPORARILY_UNAVAILABLE" })).rejects.toBeInstanceOf(ProspeoError);
  });
});

describe("enrichPerson", () => {
  const person = (email: object) => ({ error: false, person: { email } });

  it("asks only for verified emails and identifies the person by id", async () => {
    const fetchMock = vi.fn(async () => json(person({ status: "VERIFIED", revealed: true, email: "Eoghan.Mccabe@Intercom.com" })));
    vi.stubGlobal("fetch", fetchMock);
    const out = await enrichPerson({ personId: "p1" }, "k");
    expect(out).toEqual({ email: "eoghan.mccabe@intercom.com", status: "verified" });
    expect(request(fetchMock).url).toBe("https://api.prospeo.io/enrich-person");
    expect(request(fetchMock).body).toEqual({ only_verified_email: true, enrich_mobile: false, data: { person_id: "p1" } });
  });

  it("identifies someone without an id by name and company website", async () => {
    const fetchMock = vi.fn(async () => json(person({ status: "VERIFIED", email: "a@b.com" })));
    vi.stubGlobal("fetch", fetchMock);
    await enrichPerson({ firstName: "Jane", lastName: "Doe", domain: "acme.com" }, "k");
    expect(request(fetchMock).body.data).toEqual({ first_name: "Jane", last_name: "Doe", company_website: "acme.com" });
  });

  it("tries the strongest identifier first and falls through for free", async () => {
    const calls: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      const data = JSON.parse(init.body as string).data;
      calls.push(data);
      if (data.person_id) return json({ error: true, error_code: "NO_MATCH" }, 400);
      if (data.linkedin_url) return json({ error: true, error_code: "INVALID_REQUEST" }, 400);
      return json(person({ status: "VERIFIED", email: "ray@bloom.ai" }));
    }));
    const out = await enrichPerson({ personId: "p", linkedinUrl: "https://linkedin.com/in/ray", firstName: "Ray", lastName: "Fitzgerald", domain: "bloom.ai" }, "k");
    expect(out).toEqual({ email: "ray@bloom.ai", status: "verified" });
    expect(calls).toEqual([{ person_id: "p" }, { linkedin_url: "https://linkedin.com/in/ray" }, { first_name: "Ray", last_name: "Fitzgerald", company_website: "bloom.ai" }]);
  });

  it("stops at once on a credit or key error instead of trying the rest", async () => {
    const fetchMock = vi.fn(async () => json({ error: true, error_code: "INSUFFICIENT_CREDITS" }, 400));
    vi.stubGlobal("fetch", fetchMock);
    await expect(enrichPerson({ personId: "p", linkedinUrl: "https://linkedin.com/in/x" }, "k")).rejects.toThrow(/credits/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does nothing when there is nothing to identify the person by", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await enrichPerson({ firstName: "Ray" }, "k")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null for no match and for a masked (unrevealed) address", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: true, error_code: "NO_MATCH" }, 400)));
    expect(await enrichPerson({ personId: "p" }, "k")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => json(person({ status: "VERIFIED", revealed: false, email: "eoghan.*****@intercom.com" }))));
    expect(await enrichPerson({ personId: "p" }, "k")).toBeNull();
  });

  it("marks anything not VERIFIED as unverified", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(person({ status: "CATCH_ALL", email: "a@b.com" }))));
    expect((await enrichPerson({ personId: "p" }, "k"))?.status).toBe("unverified");
  });

  it("passes on credit and key errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: true, error_code: "INSUFFICIENT_CREDITS" }, 400)));
    await expect(enrichPerson({ personId: "p" }, "k")).rejects.toThrow(/credits/);
  });
});

describe("accountInfo", () => {
  it("calls the account endpoint with GET", async () => {
    const fetchMock = vi.fn(async () => json({ error: false }));
    vi.stubGlobal("fetch", fetchMock);
    await accountInfo("k");
    expect(request(fetchMock).init.method).toBe("GET");
    expect(request(fetchMock).url).toBe("https://api.prospeo.io/account-information");
  });
  it("rejects a bad key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: true, error_code: "INVALID_API_KEY" }, 400)));
    await expect(accountInfo("bad")).rejects.toThrow(/rejected the API key/);
  });
});
