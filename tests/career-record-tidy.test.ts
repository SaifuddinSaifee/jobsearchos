import { describe, expect, it } from "vitest";
import { certKey, matchCertification, matchEducation, matchSkill, pickEducation, sameEducation, uniqueCertifications } from "@/lib/career/dedupe";
import { extractFromDoc } from "@/lib/career/extract";
import { balanceBrackets, skillKey, splitOutsideBrackets } from "@/lib/career/normalize";
import { docToProfile } from "@/lib/documents/convert/doc-to-profile";
import { profileToDoc } from "@/lib/documents/convert/profile-to-doc";
import { emptyRecord } from "@/lib/career/schema";
import { counter, profileWith } from "./career-helpers";

const edu = (institution: string, degree: string, end: string, extra: Partial<Record<"field" | "start" | "details", string>> = {}) => ({
  institution,
  degree,
  field: "",
  start: "",
  end,
  details: "",
  ...extra,
});

// The seven school entries of a real record: the same three schools written different ways.
const SCHOOLS = [
  edu("Shri Vile Parle Kelavani Mandal’s Institute of Technology, India", "Bachelor of Technology (B. Tech)", "2024", { field: "Computer Engineering", details: "8/10" }),
  edu("Mayur Trust’s ZB Patil", "HSC Board", "2020"),
  edu("North Point School", "ICSE Board", "2018"),
  edu("Mayur Trust's ZB Patil, India", "HSC Board", "2020"),
  edu("North Point School, India", "ICSE Board", "2018"),
  edu("Mayur Trust’s ZB Patil – HSC Board, India", "", "2020"),
  edu("North Point School – ICSE Board, India", "", "2018"),
];

describe("splitOutsideBrackets", () => {
  it("does not split inside brackets", () => {
    expect(splitOutsideBrackets("AWS (EC2, S3, Lambda), Docker , Kafka")).toEqual(["AWS (EC2, S3, Lambda)", "Docker", "Kafka"]);
    expect(splitOutsideBrackets("")).toEqual([]);
  });

  it("is used when a resume's skills line is read, for the record and for a profile", () => {
    const profile = profileWith([]);
    profile.skills = [{ category: "Cloud", items: ["AWS (EC2, S3, Lambda)", "Docker"] }];
    const doc = profileToDoc(profile, counter("s"));
    expect(extractFromDoc(doc).skills.map((s) => s.name)).toEqual(["AWS (EC2, S3, Lambda)", "Docker"]);
    expect(docToProfile(doc).skills[0].items).toEqual(["AWS (EC2, S3, Lambda)", "Docker"]);
  });
});

describe("balanceBrackets and skillKey", () => {
  it("closes what was left open and drops what was never opened", () => {
    expect(balanceBrackets("LLM APIs (Anthropic Claude")).toBe("LLM APIs (Anthropic Claude)");
    expect(balanceBrackets("Lambda)")).toBe("Lambda");
    expect(balanceBrackets("AWS (EC2, S3)")).toBe("AWS (EC2, S3)");
    expect(balanceBrackets("Docker (")).toBe("Docker");
  });

  it("gives one key to the same skill in any order", () => {
    expect(skillKey("TypeScript/JavaScript")).toBe(skillKey("JavaScript/TypeScript"));
    expect(skillKey("Node.js")).not.toBe(skillKey("Node"));
  });

  it("matches a skill already in the record whatever its order", () => {
    const record = { ...emptyRecord(), skills: [{ id: "s1", name: "TypeScript/JavaScript", category: "", sources: [], provenance: { origin: "merge" as const, user: [] } }] };
    expect(matchSkill(record, "JavaScript/TypeScript")?.id).toBe("s1");
  });
});

describe("sameEducation and pickEducation", () => {
  it("sees the same school written with a country, a different apostrophe, or the board run on", () => {
    expect(sameEducation(SCHOOLS[1], SCHOOLS[3])).toBe(true);
    expect(sameEducation(SCHOOLS[1], SCHOOLS[5])).toBe(true);
    expect(sameEducation(SCHOOLS[2], SCHOOLS[6])).toBe(true);
  });

  it("does not join different schools, different degrees or different years", () => {
    expect(sameEducation(SCHOOLS[1], SCHOOLS[2])).toBe(false);
    expect(sameEducation(edu("State University", "BSc", "2016"), edu("State University", "MSc", "2018"))).toBe(false);
    expect(sameEducation(edu("State University", "BSc", "2016"), edu("State University", "BSc", "2020"))).toBe(false);
    expect(sameEducation(edu("MIT", "BSc", "2016"), edu("MIT Manipal", "BSc", "2016"))).toBe(false);
  });

  it("puts one degree on the resume and leaves the board exams out", () => {
    const picked = pickEducation(SCHOOLS);
    expect(picked).toHaveLength(1);
    expect(picked[0]).toMatchObject({ degree: "Bachelor of Technology (B. Tech)", details: "8/10" });
  });

  it("keeps school entries when they are all there is, once each, newest first", () => {
    const picked = pickEducation(SCHOOLS.slice(1));
    expect(picked.map((e) => e.end)).toEqual(["2020", "2018"]);
  });

  it("keeps the fuller of two repeats, and orders by end year with a current course first", () => {
    const picked = pickEducation([edu("State University", "BSc", "2016"), edu("State University", "BSc", "2016", { field: "Physics", start: "2012" }), edu("Open College", "MSc", "Present")]);
    expect(picked.map((e) => [e.institution, e.field])).toEqual([["Open College", ""], ["State University", "Physics"]]);
  });

  it("finds an existing record entry when a merge brings the same school again", () => {
    const record = {
      ...emptyRecord(),
      education: [{ id: "ed1", institution: "Mayur Trust’s ZB Patil", degree: "HSC Board", field: "", start: "", end: "2020", details: "", sources: [], provenance: { origin: "merge" as const, user: [] } }],
    };
    expect(matchEducation(record, "Mayur Trust's ZB Patil, India", "HSC Board", "2020")?.id).toBe("ed1");
    expect(matchEducation(record, "Mayur Trust's ZB Patil, India", "HSC Board", "2021")).toBeNull();
  });
});

describe("certKey", () => {
  it("is one key for the AWS pair and the Google pair", () => {
    expect(certKey("AWS Certified AI Practitioner")).toBe(certKey("AWS AI Practitioner (AIF-C01)"));
    expect(certKey("Foundation of User Experience, Google")).toBe(certKey("Foundation of User Experience", "Google"));
    expect(certKey("Responsive Web Designing", "FreeCodeCamp")).not.toBe(certKey("Google Cloud Essentials"));
  });

  it("takes repeats out of a list and finds one already in the record", () => {
    const certs = [
      { name: "Foundation of User Experience, Google", issuer: "" },
      { name: "Responsive Web Designing", issuer: "FreeCodeCamp" },
      { name: "AWS Certified AI Practitioner", issuer: "" },
      { name: "Foundation of User Experience", issuer: "Google" },
      { name: "Google Cloud Essentials", issuer: "" },
      { name: "AWS AI Practitioner (AIF-C01)", issuer: "" },
    ];
    expect(uniqueCertifications(certs).map((c) => c.name)).toEqual(["Foundation of User Experience, Google", "Responsive Web Designing", "AWS Certified AI Practitioner", "Google Cloud Essentials"]);
    const record = { ...emptyRecord(), certifications: [{ id: "c1", name: "AWS Certified AI Practitioner", issuer: "", date: "", sources: [], provenance: { origin: "merge" as const, user: [] } }] };
    expect(matchCertification(record, "AWS AI Practitioner (AIF-C01)")?.id).toBe("c1");
  });
});
