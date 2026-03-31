import { describe, it, expect } from "vitest";
import { prdDiffQuerySchema, prdProposedDiffQuerySchema } from "../schemas/request-prd.js";

describe("prdDiffQuerySchema includeContent", () => {
  it("defaults includeContent to true when omitted", () => {
    const result = prdDiffQuerySchema.parse({ fromVersion: "1" });
    expect(result.includeContent).toBe(true);
  });

  it("parses includeContent=true as true", () => {
    const result = prdDiffQuerySchema.parse({ fromVersion: "1", includeContent: "true" });
    expect(result.includeContent).toBe(true);
  });

  it("parses includeContent=false as false", () => {
    const result = prdDiffQuerySchema.parse({ fromVersion: "1", includeContent: "false" });
    expect(result.includeContent).toBe(false);
  });

  it("parses includeContent=1 as true", () => {
    const result = prdDiffQuerySchema.parse({ fromVersion: "1", includeContent: "1" });
    expect(result.includeContent).toBe(true);
  });

  it("parses includeContent=0 as false", () => {
    const result = prdDiffQuerySchema.parse({ fromVersion: "1", includeContent: "0" });
    expect(result.includeContent).toBe(false);
  });

  it("rejects invalid includeContent values", () => {
    const result = prdDiffQuerySchema.safeParse({ fromVersion: "1", includeContent: "yes" });
    expect(result.success).toBe(false);
  });
});

describe("prdProposedDiffQuerySchema includeContent", () => {
  it("defaults includeContent to true when omitted", () => {
    const result = prdProposedDiffQuerySchema.parse({ requestId: "hil-123" });
    expect(result.includeContent).toBe(true);
  });

  it("parses includeContent=false as false", () => {
    const result = prdProposedDiffQuerySchema.parse({
      requestId: "hil-123",
      includeContent: "false",
    });
    expect(result.includeContent).toBe(false);
  });

  it("parses includeContent=0 as false", () => {
    const result = prdProposedDiffQuerySchema.parse({
      requestId: "hil-123",
      includeContent: "0",
    });
    expect(result.includeContent).toBe(false);
  });
});
