import { describe, it, expect } from "vitest";
import {
  normalizeCodingStatus,
  normalizeReviewStatus,
} from "../services/result-normalizers.js";
import type { CodingAgentResult, ReviewAgentResult } from "@opensprint/shared";

describe("result-normalizers", () => {
  describe("normalizeCodingStatus", () => {
    it("normalizes 'completed' to 'success'", () => {
      const result: CodingAgentResult = {
        status: "completed",
        summary: "",
        filesChanged: [],
        testsWritten: 0,
        testsPassed: 0,
        notes: "",
      };
      normalizeCodingStatus(result);
      expect(result.status).toBe("success");
    });

    it("normalizes 'complete' to 'success'", () => {
      const result: CodingAgentResult = {
        status: "complete",
        summary: "",
        filesChanged: [],
        testsWritten: 0,
        testsPassed: 0,
        notes: "",
      };
      normalizeCodingStatus(result);
      expect(result.status).toBe("success");
    });

    it("normalizes 'done' and 'passed' to 'success'", () => {
      for (const status of ["done", "passed"]) {
        const result: CodingAgentResult = {
          status: status as "success" | "failed" | "partial",
          summary: "",
          filesChanged: [],
          testsWritten: 0,
          testsPassed: 0,
          notes: "",
        };
        normalizeCodingStatus(result);
        expect(result.status).toBe("success");
      }
    });

    it("handles case-insensitive status", () => {
      const result: CodingAgentResult = {
        status: "COMPLETED",
        summary: "",
        filesChanged: [],
        testsWritten: 0,
        testsPassed: 0,
        notes: "",
      };
      normalizeCodingStatus(result);
      expect(result.status).toBe("success");
    });

    it("leaves 'success' unchanged", () => {
      const result: CodingAgentResult = {
        status: "success",
        summary: "",
        filesChanged: [],
        testsWritten: 0,
        testsPassed: 0,
        notes: "",
      };
      normalizeCodingStatus(result);
      expect(result.status).toBe("success");
    });

    it("leaves 'failed' and 'partial' unchanged", () => {
      for (const status of ["failed", "partial"]) {
        const result: CodingAgentResult = {
          status: status as "success" | "failed" | "partial",
          summary: "",
          filesChanged: [],
          testsWritten: 0,
          testsPassed: 0,
          notes: "",
        };
        normalizeCodingStatus(result);
        expect(result.status).toBe(status);
      }
    });
  });

  describe("normalizeReviewStatus", () => {
    it("normalizes 'approve' to 'approved'", () => {
      const result: ReviewAgentResult = {
        status: "approve",
        summary: "",
        notes: "",
      } as ReviewAgentResult;
      normalizeReviewStatus(result);
      expect(result.status).toBe("approved");
    });

    it("normalizes 'success', 'accept', 'accepted' to 'approved'", () => {
      for (const status of ["success", "accept", "accepted"]) {
        const result: ReviewAgentResult = {
          status: status as "approved" | "rejected",
          summary: "",
          notes: "",
        } as ReviewAgentResult;
        normalizeReviewStatus(result);
        expect(result.status).toBe("approved");
      }
    });

    it("normalizes 'reject', 'fail', 'failed' to 'rejected'", () => {
      for (const status of ["reject", "fail", "failed"]) {
        const result: ReviewAgentResult = {
          status: status as "approved" | "rejected",
          summary: "",
          notes: "",
        } as ReviewAgentResult;
        normalizeReviewStatus(result);
        expect(result.status).toBe("rejected");
      }
    });

    it("handles case-insensitive status", () => {
      const result: ReviewAgentResult = {
        status: "REJECT",
        summary: "",
        notes: "",
      } as ReviewAgentResult;
      normalizeReviewStatus(result);
      expect(result.status).toBe("rejected");
    });

    it("leaves 'approved' and 'rejected' unchanged", () => {
      for (const status of ["approved", "rejected"]) {
        const result: ReviewAgentResult = {
          status: status as "approved" | "rejected",
          summary: "",
          notes: "",
        };
        normalizeReviewStatus(result);
        expect(result.status).toBe(status);
      }
    });

    it("handles unknown status by leaving unchanged", () => {
      const result: ReviewAgentResult = {
        status: "pending",
        summary: "",
        notes: "",
      } as ReviewAgentResult;
      normalizeReviewStatus(result);
      expect(result.status).toBe("pending");
    });
  });
});
