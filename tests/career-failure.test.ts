import { describe, expect, it } from "vitest";
import { failureFields, failureReport, parseFailure, type FailedSource } from "@/lib/career/failure";

const BODY =
  '{"id":"req-1","error":{"message":"This model only supports streaming. Set \\"stream\\": true.","type":"invalid_request_error","param":"stream","code":"streaming_required"}}';

describe("parseFailure", () => {
  it("takes apart a provider error with a step in front", () => {
    const d = parseFailure(`Could not group bullets with the model: 400 ${BODY}`);
    expect(d).toMatchObject({
      step: "Could not group bullets with the model",
      status: 400,
      message: 'This model only supports streaming. Set "stream": true.',
      type: "invalid_request_error",
      code: "streaming_required",
      param: "stream",
      requestId: "req-1",
    });
  });

  it("takes apart a provider error with no step", () => {
    const d = parseFailure(`400 ${BODY}`);
    expect(d.step).toBeNull();
    expect(d.status).toBe(400);
    expect(d.code).toBe("streaming_required");
  });

  it("reads fields by name from JSON cut short when it was stored", () => {
    const cut = `Could not read the cover letter with the model: 400 ${BODY.slice(0, 120)}`;
    const d = parseFailure(cut);
    expect(d.status).toBe(400);
    expect(d.requestId).toBe("req-1");
    expect(d.message).toBe('This model only supports streaming. Set "stream": true.');
  });

  it("keeps a plain error as the message", () => {
    const d = parseFailure("That version no longer exists.");
    expect(d).toMatchObject({ step: null, status: null, message: "That version no longer exists.", code: null });
  });

  it("says unknown when there is no error", () => {
    expect(parseFailure(null).message).toBe("Unknown error");
  });
});

describe("failureReport", () => {
  const failure: FailedSource = {
    id: "p1",
    label: "PM Resume",
    kind: "resume",
    error: `Could not group bullets with the model: 400 ${BODY}`,
    attempts: 1,
    failedAt: null,
  };

  it("lists the fields that are present, then the message and the raw error", () => {
    expect(failureFields(failure).map(([k]) => k)).toEqual([
      "Source",
      "Kind",
      "Attempts",
      "Step",
      "HTTP status",
      "Error type",
      "Error code",
      "Parameter",
      "Request id",
    ]);
    const text = failureReport([failure, { ...failure, id: "p2", label: "Letter", kind: "cover_letter", error: "Gone." }]);
    expect(text).toContain("Source: PM Resume\nKind: Resume");
    expect(text).toContain("Error code: streaming_required");
    expect(text).toContain(`Raw error: Could not group bullets`);
    expect(text).toContain("\n\nSource: Letter\nKind: Cover letter\nAttempts: 1\nMessage: Gone.");
    expect(text).not.toContain("Raw error: Gone.");
  });
});
