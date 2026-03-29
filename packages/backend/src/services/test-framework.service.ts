import fs from "fs/promises";
import path from "path";

export interface DetectedTestFramework {
  framework: string;
  testCommand: string;
}

/**
 * Detect test framework from project files (PRD §8.3).
 * Checks package.json, config files, and common patterns.
 */
export async function detectTestFramework(repoPath: string): Promise<DetectedTestFramework | null> {
  try {
    // Check package.json for Node/JS projects
    const pkgPath = path.join(repoPath, "package.json");
    try {
      const raw = await fs.readFile(pkgPath, "utf-8");
      const pkg = JSON.parse(raw);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const testScript =
        typeof pkg.scripts?.test === "string" ? pkg.scripts.test.trim().toLowerCase() : "";

      if (deps["@playwright/test"]) {
        return { framework: "playwright", testCommand: "npx playwright test" };
      }
      if (deps["cypress"]) {
        return { framework: "cypress", testCommand: "npx cypress run" };
      }
      if (deps["vitest"]) {
        return { framework: "vitest", testCommand: "node ./node_modules/vitest/vitest.mjs run" };
      }
      if (deps["jest"]) {
        return { framework: "jest", testCommand: "npm test" };
      }
      if (deps["mocha"]) {
        return { framework: "mocha", testCommand: "npm test" };
      }
      if (testScript.includes("vitest")) {
        return { framework: "vitest", testCommand: "node ./node_modules/vitest/vitest.mjs run" };
      }
      if (testScript.includes("playwright")) {
        return { framework: "playwright", testCommand: "npx playwright test" };
      }
      if (testScript.includes("cypress")) {
        return { framework: "cypress", testCommand: "npx cypress run" };
      }
      if (testScript.includes("jest")) {
        return { framework: "jest", testCommand: "npx jest" };
      }
      if (testScript.includes("pytest")) {
        return { framework: "pytest", testCommand: "pytest" };
      }
      if (testScript.includes("go test")) {
        return { framework: "go_test", testCommand: "go test ./..." };
      }
      if (testScript.includes("cargo test")) {
        return { framework: "cargo_test", testCommand: "cargo test" };
      }
      if (testScript.includes("mocha")) {
        return { framework: "mocha", testCommand: "npm test" };
      }
    } catch {
      // No package.json or invalid
    }

    // Check for config files before falling back to a generic package.json test script.
    const configs: { file: string; framework: string; command: string }[] = [
      {
        file: "vitest.workspace.ts",
        framework: "vitest",
        command: "node ./node_modules/vitest/vitest.mjs run",
      },
      {
        file: "vitest.workspace.js",
        framework: "vitest",
        command: "node ./node_modules/vitest/vitest.mjs run",
      },
      {
        file: "vitest.config.ts",
        framework: "vitest",
        command: "node ./node_modules/vitest/vitest.mjs run",
      },
      {
        file: "vitest.config.js",
        framework: "vitest",
        command: "node ./node_modules/vitest/vitest.mjs run",
      },
      { file: "jest.config.js", framework: "jest", command: "npx jest" },
      { file: "jest.config.ts", framework: "jest", command: "npx jest" },
      { file: "playwright.config.ts", framework: "playwright", command: "npx playwright test" },
      { file: "cypress.config.js", framework: "cypress", command: "npx cypress run" },
      { file: "pytest.ini", framework: "pytest", command: "pytest" },
      { file: "pyproject.toml", framework: "pytest", command: "pytest" },
      { file: "go.mod", framework: "go_test", command: "go test ./..." },
      { file: "Cargo.toml", framework: "cargo_test", command: "cargo test" },
    ];

    for (const { file, framework, command } of configs) {
      try {
        await fs.access(path.join(repoPath, file));
        return { framework, testCommand: command };
      } catch {
        // Config not found
      }
    }

    try {
      const raw = await fs.readFile(pkgPath, "utf-8");
      const pkg = JSON.parse(raw);
      if (pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
        return { framework: "jest", testCommand: "npm test" };
      }
    } catch {
      // No package.json or invalid
    }

    // Check for setup.py (Python)
    try {
      await fs.access(path.join(repoPath, "setup.py"));
      return { framework: "pytest", testCommand: "pytest" };
    } catch {
      // Not found
    }

    // Detect Go projects when no explicit test framework was found.
    try {
      await fs.access(path.join(repoPath, "go.mod"));
      return { framework: "go_test", testCommand: "go test ./..." };
    } catch {
      // Not found
    }

    // Detect Rust projects when no explicit test framework was found.
    try {
      await fs.access(path.join(repoPath, "Cargo.toml"));
      return { framework: "cargo_test", testCommand: "cargo test" };
    } catch {
      // Not found
    }

    return null;
  } catch {
    return null;
  }
}
