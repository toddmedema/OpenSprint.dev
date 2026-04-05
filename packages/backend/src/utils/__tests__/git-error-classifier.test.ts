import { describe, it, expect } from "vitest";
import {
  getErrorText,
  isNoRebaseInProgressError,
  isBranchNotFoundError,
  shouldAttemptRebaseSkip,
} from "../git-error-classifier.js";

describe("git-error-classifier", () => {
  describe("getErrorText", () => {
    it("returns the string as-is for string input", () => {
      expect(getErrorText("some error")).toBe("some error");
    });

    it("extracts message from an Error instance", () => {
      expect(getErrorText(new Error("boom"))).toBe("boom");
    });

    it("extracts stderr from a plain object", () => {
      const obj = { message: "cmd failed", stderr: "fatal: bad ref" };
      const text = getErrorText(obj);
      expect(text).toContain("cmd failed");
      expect(text).toContain("fatal: bad ref");
    });

    it("falls back to String() for non-object/non-string values", () => {
      expect(getErrorText(42)).toBe("42");
      expect(getErrorText(null)).toBe("null");
    });
  });

  describe("isNoRebaseInProgressError", () => {
    it("returns true for 'fatal: No rebase in progress?'", () => {
      expect(isNoRebaseInProgressError(new Error("fatal: No rebase in progress?"))).toBe(true);
    });

    it("returns true for case-insensitive match", () => {
      expect(isNoRebaseInProgressError("FATAL: NO REBASE IN PROGRESS")).toBe(true);
    });

    it("returns false for unrelated errors", () => {
      expect(isNoRebaseInProgressError(new Error("merge conflict"))).toBe(false);
    });
  });

  describe("isBranchNotFoundError", () => {
    it("returns true for 'error: branch 'foo' not found.'", () => {
      expect(isBranchNotFoundError(new Error("error: branch 'foo' not found."))).toBe(true);
    });

    it("returns true for exit code 1 with branch -D command", () => {
      const err = { code: 1, cmd: "git branch -D opensprint/task-abc" };
      expect(isBranchNotFoundError(err)).toBe(true);
    });

    it("returns true for exitCode property variant", () => {
      const err = { exitCode: 1, cmd: "git branch -D old-branch" };
      expect(isBranchNotFoundError(err)).toBe(true);
    });

    it("returns false for unrelated errors", () => {
      expect(isBranchNotFoundError(new Error("permission denied"))).toBe(false);
    });

    it("returns false for exit code 1 without branch -D", () => {
      const err = { code: 1, cmd: "git checkout main" };
      expect(isBranchNotFoundError(err)).toBe(false);
    });
  });

  describe("shouldAttemptRebaseSkip", () => {
    it("returns true for 'could not apply abc123...'", () => {
      expect(shouldAttemptRebaseSkip(new Error("could not apply abc123... some commit"))).toBe(
        true
      );
    });

    it("returns true for 'previous cherry-pick is now empty'", () => {
      expect(shouldAttemptRebaseSkip("previous cherry-pick is now empty")).toBe(true);
    });

    it("returns true for 'nothing to commit'", () => {
      expect(shouldAttemptRebaseSkip(new Error("nothing to commit, working tree clean"))).toBe(
        true
      );
    });

    it("returns true for 'you can instead skip this commit'", () => {
      expect(shouldAttemptRebaseSkip("you can instead skip this commit")).toBe(true);
    });

    it("returns false for unrelated errors", () => {
      expect(shouldAttemptRebaseSkip(new Error("branch diverged"))).toBe(false);
    });

    it("returns false for empty input", () => {
      expect(shouldAttemptRebaseSkip("")).toBe(false);
    });
  });
});
