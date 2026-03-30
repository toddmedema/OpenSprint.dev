import { describe, it, expect } from "vitest";
import {
  auditProtectedPaths,
  formatViolationSummary,
  PROTECTED_PATH_PATTERNS,
  SCOPE_UNLOCK_KEYWORDS,
} from "../services/protected-path-policy.js";

describe("auditProtectedPaths", () => {
  describe("violations detected for non-integration tasks", () => {
    it("flags routes/integrations-* files", () => {
      const result = auditProtectedPaths(
        ["packages/backend/src/routes/integrations-todoist.ts"],
        "Fix button color",
        "Update the primary button color to blue"
      );
      expect(result.allowed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].matchedPattern.label).toBe("Integration routes");
      expect(result.scopeUnlocked).toBe(false);
    });

    it("flags integration-store files", () => {
      const result = auditProtectedPaths(
        ["packages/backend/src/services/integration-store.service.ts"],
        "Refactor task store",
        "Clean up the task store service"
      );
      expect(result.allowed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].matchedPattern.label).toBe("Integration store service");
    });

    it("flags token-encryption files", () => {
      const result = auditProtectedPaths(
        ["packages/backend/src/services/token-encryption.service.ts"],
        "Add logging",
        "Add structured logging to all services"
      );
      expect(result.allowed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].matchedPattern.label).toBe("Token encryption service");
    });

    it("flags todoist-sync files", () => {
      const result = auditProtectedPaths(
        ["packages/backend/src/services/todoist-sync.service.ts"],
        "Update UI layout",
        "Adjust the dashboard layout"
      );
      expect(result.allowed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].matchedPattern.label).toBe("Todoist sync service");
    });

    it("flags multiple violations from different protected patterns", () => {
      const result = auditProtectedPaths(
        [
          "packages/backend/src/routes/integrations-todoist.ts",
          "packages/backend/src/services/token-encryption.service.ts",
          "packages/frontend/src/App.tsx",
        ],
        "Fix button color",
        "Update styles"
      );
      expect(result.allowed).toBe(false);
      expect(result.violations).toHaveLength(2);
      const labels = result.violations.map((v) => v.matchedPattern.label);
      expect(labels).toContain("Integration routes");
      expect(labels).toContain("Token encryption service");
    });
  });

  describe("no violations for non-protected files", () => {
    it("allows changes to regular service files", () => {
      const result = auditProtectedPaths(
        [
          "packages/backend/src/services/task-store.service.ts",
          "packages/frontend/src/components/Button.tsx",
        ],
        "Fix button color",
        "Update the primary button color"
      );
      expect(result.allowed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("allows empty file list", () => {
      const result = auditProtectedPaths([], "Some task", "Some description");
      expect(result.allowed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });

  describe("scope keywords unlock protected paths", () => {
    it.each(SCOPE_UNLOCK_KEYWORDS)(
      "unlocks with keyword '%s' in title",
      (keyword) => {
        const result = auditProtectedPaths(
          ["packages/backend/src/services/integration-store.service.ts"],
          `Task about ${keyword} setup`,
          "Generic description"
        );
        expect(result.allowed).toBe(true);
        expect(result.scopeUnlocked).toBe(true);
        expect(result.violations).toHaveLength(1);
      }
    );

    it("unlocks with keyword in description", () => {
      const result = auditProtectedPaths(
        ["packages/backend/src/services/integration-store.service.ts"],
        "Set up third-party sync",
        "This task configures the Todoist integration"
      );
      expect(result.allowed).toBe(true);
      expect(result.scopeUnlocked).toBe(true);
    });

    it("matches keywords case-insensitively", () => {
      const result = auditProtectedPaths(
        ["packages/backend/src/routes/integrations-todoist.ts"],
        "INTEGRATION Routes Fix",
        ""
      );
      expect(result.allowed).toBe(true);
      expect(result.scopeUnlocked).toBe(true);
    });

    it("does not unlock with partial keyword mismatch", () => {
      const result = auditProtectedPaths(
        ["packages/backend/src/services/integration-store.service.ts"],
        "Fix integer parsing",
        "Handle integer overflow"
      );
      expect(result.allowed).toBe(false);
      expect(result.scopeUnlocked).toBe(false);
    });

    it("unlocks with 'integration' keyword even in compound words", () => {
      const result = auditProtectedPaths(
        ["packages/backend/src/services/integration-store.service.ts"],
        "Update integration-store encryption",
        ""
      );
      expect(result.allowed).toBe(true);
      expect(result.scopeUnlocked).toBe(true);
    });
  });

  describe("sample audit: UI-only task rejected for touching integration files", () => {
    it("rejects a UI-only task that modifies integration routes", () => {
      const result = auditProtectedPaths(
        [
          "packages/frontend/src/components/Dashboard.tsx",
          "packages/frontend/src/styles/dashboard.css",
          "packages/backend/src/routes/integrations-todoist.ts",
        ],
        "Update dashboard layout",
        "Adjust the spacing and alignment of dashboard cards"
      );
      expect(result.allowed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].file).toBe(
        "packages/backend/src/routes/integrations-todoist.ts"
      );
    });
  });

  describe("legitimate integration tasks pass", () => {
    it("allows an integration task to modify all protected paths", () => {
      const result = auditProtectedPaths(
        [
          "packages/backend/src/routes/integrations-todoist.ts",
          "packages/backend/src/services/integration-store.service.ts",
          "packages/backend/src/services/token-encryption.service.ts",
          "packages/backend/src/services/todoist-sync.service.ts",
        ],
        "Add Todoist OAuth integration",
        "Implement the full Todoist OAuth flow with token encryption"
      );
      expect(result.allowed).toBe(true);
      expect(result.scopeUnlocked).toBe(true);
      expect(result.violations).toHaveLength(4);
    });
  });
});

describe("formatViolationSummary", () => {
  it("returns empty string when no violations", () => {
    expect(formatViolationSummary([])).toBe("");
  });

  it("formats single violation", () => {
    const summary = formatViolationSummary([
      {
        file: "src/services/integration-store.service.ts",
        matchedPattern: { pattern: "integration-store", label: "Integration store service" },
      },
    ]);
    expect(summary).toContain("integration-store.service.ts");
    expect(summary).toContain("Integration store service");
    expect(summary).toContain("Protected Path Policy");
  });

  it("formats multiple violations", () => {
    const summary = formatViolationSummary([
      {
        file: "src/routes/integrations-todoist.ts",
        matchedPattern: { pattern: "routes/integrations-", label: "Integration routes" },
      },
      {
        file: "src/services/token-encryption.service.ts",
        matchedPattern: { pattern: "token-encryption", label: "Token encryption service" },
      },
    ]);
    expect(summary).toContain("Integration routes");
    expect(summary).toContain("Token encryption service");
    const lines = summary.split("\n").filter((l) => l.startsWith("- "));
    expect(lines).toHaveLength(2);
  });
});

describe("PROTECTED_PATH_PATTERNS", () => {
  it("includes all expected patterns", () => {
    const patterns = PROTECTED_PATH_PATTERNS.map((p) => p.pattern);
    expect(patterns).toContain("routes/integrations-");
    expect(patterns).toContain("integration-store");
    expect(patterns).toContain("token-encryption");
    expect(patterns).toContain("routes/oauth");
    expect(patterns).toContain("todoist-sync");
  });

  it("each pattern has a non-empty label", () => {
    for (const p of PROTECTED_PATH_PATTERNS) {
      expect(p.label).toBeTruthy();
      expect(p.label.length).toBeGreaterThan(0);
    }
  });
});

describe("SCOPE_UNLOCK_KEYWORDS", () => {
  it("includes expected keywords", () => {
    expect(SCOPE_UNLOCK_KEYWORDS).toContain("integration");
    expect(SCOPE_UNLOCK_KEYWORDS).toContain("oauth");
    expect(SCOPE_UNLOCK_KEYWORDS).toContain("todoist");
    expect(SCOPE_UNLOCK_KEYWORDS).toContain("token-encrypt");
    expect(SCOPE_UNLOCK_KEYWORDS).toContain("third-party-auth");
  });

  it("all keywords are lowercase", () => {
    for (const kw of SCOPE_UNLOCK_KEYWORDS) {
      expect(kw).toBe(kw.toLowerCase());
    }
  });
});
