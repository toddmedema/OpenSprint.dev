import { describe, it, expect } from "vitest";
import { getErrorMessage } from "../utils/error-utils.js";

describe("getErrorMessage", () => {
  it("returns message from Error instance", () => {
    const err = new Error("Something went wrong");
    expect(getErrorMessage(err)).toBe("Something went wrong");
  });

  it("returns fallback when err is not Error and fallback is provided", () => {
    expect(getErrorMessage("string error", "fallback")).toBe("fallback");
    expect(getErrorMessage(42, "fallback")).toBe("fallback");
    expect(getErrorMessage(null, "fallback")).toBe("fallback");
    expect(getErrorMessage(undefined, "fallback")).toBe("fallback");
  });

  it("returns String(err) when err is not Error and no fallback", () => {
    expect(getErrorMessage("string error")).toBe("string error");
    expect(getErrorMessage(42)).toBe("42");
    expect(getErrorMessage(null)).toBe("null");
    expect(getErrorMessage(undefined)).toBe("undefined");
  });

  it("ignores fallback when err is Error", () => {
    const err = new Error("actual message");
    expect(getErrorMessage(err, "fallback")).toBe("actual message");
  });

  it("handles Error subclasses", () => {
    class CustomError extends Error {
      constructor(msg: string) {
        super(msg);
        this.name = "CustomError";
      }
    }
    const err = new CustomError("custom");
    expect(getErrorMessage(err)).toBe("custom");
  });

  it("handles empty string fallback", () => {
    expect(getErrorMessage(42, "")).toBe("");
  });
});
