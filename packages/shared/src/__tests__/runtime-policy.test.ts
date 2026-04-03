import { describe, expect, it } from "vitest";
import {
  UNSUPPORTED_WSL_REPO_PATH_MESSAGE,
  isWindowsMountedWslPath,
} from "../runtime-policy.js";

describe("runtime-policy", () => {
  it("detects repos mounted from Windows drives inside WSL", () => {
    expect(isWindowsMountedWslPath("/mnt/c/Users/todd/opensprint")).toBe(true);
    expect(isWindowsMountedWslPath(" /mnt/d/work/repo ")).toBe(true);
  });

  it("does not flag native Linux paths as Windows-mounted", () => {
    expect(isWindowsMountedWslPath("/home/todd/src/app")).toBe(false);
  });

  it("exports guidance for unsupported WSL repo paths", () => {
    expect(UNSUPPORTED_WSL_REPO_PATH_MESSAGE).toContain("/mnt/c/");
  });
});
