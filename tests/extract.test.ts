import { describe, expect, it } from "vitest";
import { detectKind, extractResumeText, normalizeText } from "@/lib/resume/extract";

describe("resume extraction", () => {
  it("detects supported file kinds", () => {
    expect(detectKind("cv.PDF", "")).toBe("pdf");
    expect(detectKind("cv.docx", "")).toBe("docx");
    expect(detectKind("cv.txt", "text/plain")).toBeNull();
  });

  it("normalizes whitespace", () => {
    expect(normalizeText("a  b\r\n\r\n\r\n\r\nc \n d")).toBe("a b\n\nc\nd");
  });

  it("rejects unsupported types", async () => {
    await expect(extractResumeText(Buffer.from("x"), "cv.txt", "text/plain")).rejects.toThrow(
      /PDF and DOCX/,
    );
  });
});
