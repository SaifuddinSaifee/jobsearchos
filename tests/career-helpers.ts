import { emptyProfile, type Profile } from "@/lib/profile/schema";
import { emptyRecord, mergeProvenance, type CareerRecord, type Employer, type Fact, type Role } from "@/lib/career/schema";

export const SOURCE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const SOURCE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** Deterministic ids: n1, n2, ... */
export function counter(prefix = "n") {
  let i = 0;
  return () => `${prefix}${++i}`;
}

export function profileWith(experience: Partial<Profile["experience"][number]>[]): Profile {
  const p = emptyProfile();
  p.experience = experience.map((e) => ({
    company: "Acme",
    title: "Engineer",
    location: "",
    start: "Jan 2020",
    end: "Dec 2021",
    current: false,
    bullets: [],
    ...e,
  }));
  return p;
}

export function fact(id: string, wordings: [string, string, string[]?][]): Fact {
  return {
    id,
    provenance: mergeProvenance(),
    wordings: wordings.map(([wid, text, blocks]) => ({
      id: wid,
      text,
      framingId: null,
      form: "bullet" as const,
      sources: (blocks ?? [null]).map((b) => ({ sourceId: SOURCE_A, blockId: b })),
      provenance: mergeProvenance(),
    })),
  };
}

export function role(over: Partial<Role> & { title?: string } = {}): Role {
  const { title = "Engineer", ...rest } = over;
  return {
    id: "role1",
    start: "Jan 2020",
    end: "Dec 2021",
    current: false,
    location: "",
    dateNotes: [],
    framings: [
      { id: "fr1", title, angle: "Engineering", targetRoles: [], sources: [{ sourceId: SOURCE_A, blockId: null }], provenance: mergeProvenance() },
    ],
    facts: [],
    sources: [{ sourceId: SOURCE_A, blockId: null }],
    provenance: mergeProvenance(),
    ...rest,
  };
}

export function employer(name: string, roles: Role[], over: Partial<Employer> = {}): Employer {
  return {
    id: "emp1",
    name,
    companyId: null,
    names: [name],
    roles,
    sources: [{ sourceId: SOURCE_A, blockId: null }],
    provenance: mergeProvenance(),
    ...over,
  };
}

export function recordWith(...employers: Employer[]): CareerRecord {
  return { ...emptyRecord(), employers };
}
