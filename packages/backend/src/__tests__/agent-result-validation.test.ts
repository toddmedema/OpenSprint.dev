import { describe, it, expect } from "vitest";
import {
  parseCodingAgentResult,
  parseMergerAgentResult,
  parseReviewAgentResult,
  describeStructuredOutputProblem,
} from "../services/agent-result-validation.js";

describe("agent-result-validation", () => {
  describe("parseCodingAgentResult", () => {
    it("returns null for null, undefined, and whitespace-only input", () => {
      expect(parseCodingAgentResult(null)).toBeNull();
      expect(parseCodingAgentResult(undefined)).toBeNull();
      expect(parseCodingAgentResult("")).toBeNull();
      expect(parseCodingAgentResult("   \n\t  ")).toBeNull();
    });

    it("returns null for invalid JSON", () => {
      expect(parseCodingAgentResult("{")).toBeNull();
      expect(parseCodingAgentResult("not json")).toBeNull();
    });

    it("returns null when JSON is not a plain object", () => {
      expect(parseCodingAgentResult("[]")).toBeNull();
      expect(parseCodingAgentResult('"str"')).toBeNull();
      expect(parseCodingAgentResult("42")).toBeNull();
      expect(parseCodingAgentResult("null")).toBeNull();
    });

    it("returns null when status is missing or not a string", () => {
      expect(parseCodingAgentResult("{}")).toBeNull();
      expect(parseCodingAgentResult(JSON.stringify({ status: 1 }))).toBeNull();
      expect(parseCodingAgentResult(JSON.stringify({ status: null }))).toBeNull();
    });

    it("returns null when normalized status is not success or failed", () => {
      expect(
        parseCodingAgentResult(JSON.stringify({ status: "partial", summary: "x" }))
      ).toBeNull();
      expect(
        parseCodingAgentResult(JSON.stringify({ status: "unknown", summary: "x" }))
      ).toBeNull();
    });

    it("returns null when summary is empty and there are no open questions", () => {
      expect(
        parseCodingAgentResult(
          JSON.stringify({
            status: "success",
            summary: "",
          })
        )
      ).toBeNull();
      expect(
        parseCodingAgentResult(
          JSON.stringify({
            status: "failed",
            summary: "   ",
          })
        )
      ).toBeNull();
    });

    it("applies summary fallback when summary is empty but open_questions has valid items", () => {
      const raw = JSON.stringify({
        status: "failed",
        summary: "",
        open_questions: [{ id: "q1", text: "What scope?" }],
      });
      const parsed = parseCodingAgentResult(raw);
      expect(parsed).not.toBeNull();
      expect(parsed!.summary).toBe("Needs clarification before proceeding.");
      expect(parsed!.open_questions).toEqual([{ id: "q1", text: "What scope?" }]);
      expect(parsed!.status).toBe("failed");
    });

    it("applies summary fallback for camelCase openQuestions", () => {
      const raw = JSON.stringify({
        status: "success",
        summary: "",
        openQuestions: [{ text: "Clarify API" }],
      });
      const parsed = parseCodingAgentResult(raw);
      expect(parsed).not.toBeNull();
      expect(parsed!.summary).toBe("Needs clarification before proceeding.");
      expect(parsed!.openQuestions).toEqual([{ id: "q1", text: "Clarify API" }]);
    });

    it("assigns default q1, q2 ids when id is missing or empty", () => {
      const raw = JSON.stringify({
        status: "failed",
        summary: "x",
        open_questions: [{ text: "A" }, { id: "", text: "B" }, { id: "  ", text: "C" }],
      });
      const parsed = parseCodingAgentResult(raw);
      expect(parsed!.open_questions).toEqual([
        { id: "q1", text: "A" },
        { id: "q2", text: "B" },
        { id: "q3", text: "C" },
      ]);
    });

    it("trims open question text and drops entries with empty text after trim", () => {
      const raw = JSON.stringify({
        status: "success",
        summary: "ok",
        open_questions: [{ text: "  valid  " }, { text: "   " }, { text: "" }],
      });
      const parsed = parseCodingAgentResult(raw);
      expect(parsed!.open_questions).toEqual([{ id: "q1", text: "valid" }]);
    });

    it("omits open_questions when array has no valid items", () => {
      const raw = JSON.stringify({
        status: "success",
        summary: "done",
        open_questions: [{ text: 1 }, "x", null, { id: "q1" }],
      });
      const parsed = parseCodingAgentResult(raw);
      expect(parsed!.open_questions).toBeUndefined();
    });

    it("normalizes coding status aliases to success", () => {
      const parsed = parseCodingAgentResult(
        JSON.stringify({ status: "completed", summary: "Shipped" })
      );
      expect(parsed!.status).toBe("success");
      expect(parsed!.summary).toBe("Shipped");
    });

    it("fills defaults for filesChanged, tests, and notes", () => {
      const parsed = parseCodingAgentResult(
        JSON.stringify({ status: "success", summary: "Minimal" })
      );
      expect(parsed!.filesChanged).toEqual([]);
      expect(parsed!.testsWritten).toBe(0);
      expect(parsed!.testsPassed).toBe(0);
      expect(parsed!.notes).toBe("");
    });

    it("filters filesChanged to strings only", () => {
      const parsed = parseCodingAgentResult(
        JSON.stringify({
          status: "success",
          summary: "x",
          filesChanged: ["a.ts", 1, null, "b.ts"],
        })
      );
      expect(parsed!.filesChanged).toEqual(["a.ts", "b.ts"]);
    });

    it("extracts debugArtifact when present in result JSON", () => {
      const result = parseCodingAgentResult(
        JSON.stringify({
          status: "success",
          summary: "Implemented the feature",
          debugArtifact: {
            rootCauseCategory: "code_defect",
            evidence: "Unused import caused lint failure",
            fixApplied: "Removed unused import",
            verificationCommand: "npm run lint",
            verificationPassed: true,
            residualRisk: null,
            nextAction: "continue",
          },
        })
      );

      expect(result).not.toBeNull();
      expect(result!.status).toBe("success");
      expect(result!.debugArtifact).toBeDefined();
      expect(result!.debugArtifact!.rootCauseCategory).toBe("code_defect");
      expect(result!.debugArtifact!.evidence).toBe("Unused import caused lint failure");
      expect(result!.debugArtifact!.verificationPassed).toBe(true);
    });

    it("returns result without debugArtifact when not present", () => {
      const result = parseCodingAgentResult(
        JSON.stringify({
          status: "success",
          summary: "Done",
        })
      );

      expect(result).not.toBeNull();
      expect(result!.debugArtifact).toBeUndefined();
    });

    it("ignores malformed debugArtifact without breaking parse", () => {
      const result = parseCodingAgentResult(
        JSON.stringify({
          status: "success",
          summary: "Done",
          debugArtifact: "not an object",
        })
      );

      expect(result).not.toBeNull();
      expect(result!.debugArtifact).toBeUndefined();
    });
  });

  describe("parseReviewAgentResult", () => {
    it("returns null for empty input and invalid JSON like coding parser", () => {
      expect(parseReviewAgentResult(null)).toBeNull();
      expect(parseReviewAgentResult("{")).toBeNull();
      expect(parseReviewAgentResult("[]")).toBeNull();
    });

    it("returns null when status is missing", () => {
      expect(parseReviewAgentResult(JSON.stringify({ summary: "x" }))).toBeNull();
    });

    it("applies fallback summary when summary is empty after trim", () => {
      const approved = parseReviewAgentResult(
        JSON.stringify({ status: "approved", summary: "" })
      );
      expect(approved).not.toBeNull();
      expect(approved!.status).toBe("approved");
      expect(approved!.summary).toBe("Approved (no summary provided)");

      const rejected = parseReviewAgentResult(
        JSON.stringify({ status: "rejected", summary: "  " })
      );
      expect(rejected).not.toBeNull();
      expect(rejected!.status).toBe("rejected");
      expect(rejected!.summary).toBe("Rejected (no summary provided)");
    });

    it("returns null when normalized status is not approved or rejected", () => {
      expect(
        parseReviewAgentResult(JSON.stringify({ status: "pending", summary: "waiting" }))
      ).toBeNull();
    });

    it("normalizes review status and accepts non-empty summary", () => {
      const parsed = parseReviewAgentResult(JSON.stringify({ status: "accept", summary: "LGTM" }));
      expect(parsed!.status).toBe("approved");
      expect(parsed!.summary).toBe("LGTM");
    });

    it("includes optional issues when present", () => {
      const parsed = parseReviewAgentResult(
        JSON.stringify({
          status: "rejected",
          summary: "Fix tests",
          issues: ["a", 2, "b"],
        })
      );
      expect(parsed!.issues).toEqual(["a", "b"]);
    });

    it("extracts debugArtifact from review result", () => {
      const result = parseReviewAgentResult(
        JSON.stringify({
          status: "approved",
          summary: "Code looks good",
          debugArtifact: {
            rootCauseCategory: "env_defect",
            evidence: "node_modules was stale",
            fixApplied: "Ran npm ci",
            verificationCommand: "npm run test",
            verificationPassed: true,
            residualRisk: null,
            nextAction: "continue",
          },
        })
      );

      expect(result).not.toBeNull();
      expect(result!.debugArtifact).toBeDefined();
      expect(result!.debugArtifact!.rootCauseCategory).toBe("env_defect");
    });

    it("returns result without debugArtifact when not present", () => {
      const result = parseReviewAgentResult(
        JSON.stringify({
          status: "rejected",
          summary: "Tests fail",
          issues: ["Test x is broken"],
        })
      );

      expect(result).not.toBeNull();
      expect(result!.debugArtifact).toBeUndefined();
    });
  });

  describe("parseMergerAgentResult", () => {
    it("returns null for empty input and invalid JSON", () => {
      expect(parseMergerAgentResult(null)).toBeNull();
      expect(parseMergerAgentResult("not json")).toBeNull();
    });

    it("returns null when status is missing or not success/failed", () => {
      expect(parseMergerAgentResult(JSON.stringify({ summary: "x" }))).toBeNull();
      expect(parseMergerAgentResult(JSON.stringify({ status: "maybe", summary: "x" }))).toBeNull();
    });

    it("returns null when summary is missing or whitespace-only", () => {
      expect(parseMergerAgentResult(JSON.stringify({ status: "success", summary: "" }))).toBeNull();
      expect(
        parseMergerAgentResult(JSON.stringify({ status: "success", summary: "  \t " }))
      ).toBeNull();
    });

    it("normalizes status case and trims summary", () => {
      expect(
        parseMergerAgentResult(JSON.stringify({ status: "SUCCESS", summary: " Done " }))
      ).toEqual({
        status: "success",
        summary: "Done",
      });
    });

    it("includes notes only when non-empty after trim", () => {
      expect(
        parseMergerAgentResult(JSON.stringify({ status: "failed", summary: "x", notes: "  " }))
      ).toEqual({ status: "failed", summary: "x" });
      expect(
        parseMergerAgentResult(
          JSON.stringify({ status: "failed", summary: "x", notes: " details " })
        )
      ).toEqual({ status: "failed", summary: "x", notes: "details" });
    });

    it("extracts debugArtifact from merger result", () => {
      const result = parseMergerAgentResult(
        JSON.stringify({
          status: "success",
          summary: "Resolved conflicts",
          debugArtifact: {
            rootCauseCategory: "dependency_defect",
            evidence: "Conflicting package-lock.json",
            fixApplied: "Regenerated lockfile",
            verificationCommand: "npm ci && npm test",
            verificationPassed: true,
            residualRisk: null,
            nextAction: "continue",
          },
        })
      );

      expect(result).not.toBeNull();
      expect(result!.debugArtifact).toBeDefined();
      expect(result!.debugArtifact!.rootCauseCategory).toBe("dependency_defect");
    });

    it("returns result without debugArtifact when not present", () => {
      const result = parseMergerAgentResult(
        JSON.stringify({
          status: "success",
          summary: "Resolved all conflicts",
        })
      );

      expect(result).not.toBeNull();
      expect(result!.debugArtifact).toBeUndefined();
    });
  });

  describe("describeStructuredOutputProblem", () => {
    it("describes missing, empty, and malformed content", () => {
      expect(
        describeStructuredOutputProblem({
          fileLabel: "result.json",
          rawContent: null,
          expectedShape: "status + summary",
        })
      ).toContain("was missing");

      expect(
        describeStructuredOutputProblem({
          fileLabel: "result.json",
          rawContent: "  ",
          expectedShape: "status + summary",
        })
      ).toContain("was empty");

      const long = "x".repeat(2000);
      const msg = describeStructuredOutputProblem({
        fileLabel: "out.json",
        rawContent: long,
        expectedShape: "object",
      });
      expect(msg).toContain("did not match");
      expect(msg.length).toBeLessThanOrEqual(long.length + 500);
    });
  });
});
