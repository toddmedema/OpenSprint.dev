/**
 * Maps low-level merge / quality-gate environment_setup reasons to short,
 * user-facing titles and one-line explanations. Used by execution diagnostics.
 */

export interface HumanizeEnvironmentSetupInput {
  category?: "quality_gate" | "environment_setup" | null;
  reason?: string | null;
  outputSnippet?: string | null;
  validationWorkspace?: "baseline" | "merged_candidate" | "task_worktree" | "repo_root" | null;
  repairAttempted?: boolean;
  repairSucceeded?: boolean;
}

export interface HumanizeEnvironmentSetupResult {
  userTitle: string;
  userSummary: string;
}

type Rule = {
  test: RegExp;
  userTitle: string;
  userSummary: string;
};

const ENV_SETUP_RULES: Rule[] = [
  {
    test: /Validation workspace node_modules is missing or empty/i,
    userTitle: "Dependencies missing in merge check",
    userSummary:
      "Dependencies were not installed in the temporary merge preview folder Open Sprint uses to validate merges.",
  },
  {
    test: /Validation workspace dependency health check failed/i,
    userTitle: "Dependency check failed",
    userSummary:
      "Installed packages in the temporary merge preview did not pass a dependency health check.",
  },
  {
    test: /Validation workspace package-lock\.json is missing/i,
    userTitle: "Lockfile missing in merge check",
    userSummary:
      "package-lock.json was not found in the temporary validation workspace used for merge checks.",
  },
  {
    test: /Validation workspace package\.json is missing/i,
    userTitle: "Project manifest missing",
    userSummary:
      "package.json was not found in the temporary validation workspace used for merge checks.",
  },
  {
    test: /Failed to read validation workspace package\.json/i,
    userTitle: "Could not read project manifest",
    userSummary:
      "Open Sprint could not read package.json in the temporary validation workspace used for merge checks.",
  },
  {
    test: /Validation workspace is missing/i,
    userTitle: "Validation workspace missing",
    userSummary:
      "The temporary folder used for merge validation was missing or could not be accessed.",
  },
  {
    test: /Workspace not ready:/i,
    userTitle: "Workspace not ready",
    userSummary:
      "The pre-gate health check found missing dependencies, lockfiles, or an invalid git state in the workspace.",
  },
  {
    test: /git is not available in PATH for merge validation/i,
    userTitle: "Git unavailable",
    userSummary: "Git is required for merge validation but was not found in the environment path.",
  },
  {
    test: /Executable is not available in PATH/i,
    userTitle: "Required tool not found",
    userSummary:
      "A command required to run the quality gate is not available in the validation environment.",
  },
  {
    test: /\[post-repair verification\][\s\S]*node_modules is missing[\s\S]*after all repair attempts/i,
    userTitle: "Dependencies still missing after repair",
    userSummary:
      "Automatic repair tried to restore dependencies in the merge preview, but node_modules is still missing or empty.",
  },
  {
    test: /\[post-repair verification\][\s\S]*Dependency health check failed/i,
    userTitle: "Dependency health check still failing",
    userSummary:
      "After automatic repair, installed packages in the merge preview still failed a dependency health check.",
  },
  {
    test: /\[post-repair verification\][\s\S]*Critical files still missing/i,
    userTitle: "Critical files still missing",
    userSummary:
      "Required project files were still missing in the merge preview after automatic repair.",
  },
  {
    test: /\[npm ci @/i,
    userTitle: "Dependency install failed",
    userSummary:
      "Open Sprint tried to run npm ci to fix the merge preview environment, but the install step failed.",
  },
  {
    test: /\[symlinkNodeModules\]/i,
    userTitle: "Could not link dependencies",
    userSummary:
      "Linking node_modules from your repository into the temporary merge preview workspace failed.",
  },
  {
    test: /Cannot find module/i,
    userTitle: "Missing dependency",
    userSummary:
      "A required package could not be loaded in the merge validation environment—often due to an incomplete or incompatible install.",
  },
  {
    test: /emitter\.removeListener is not a function/i,
    userTitle: "Test runner environment issue",
    userSummary:
      "The test runner hit a Node.js compatibility problem, commonly caused by a broken or incomplete dependency install in the validation workspace.",
  },
  {
    test: /native addon|could not locate the bindings file|was compiled against a different node\.js version/i,
    userTitle: "Native dependency issue",
    userSummary:
      "A native module failed to load in the validation environment—often a Node version mismatch or incomplete install.",
  },
  {
    test: /matched high-confidence environment fingerprint|matched ambiguous environment fingerprint/i,
    userTitle: "Merge check environment",
    userSummary:
      "The temporary merge preview hit an environment or tooling problem rather than a failure in your source changes.",
  },
];

const MERGE_PREVIEW_FALLBACK: HumanizeEnvironmentSetupResult = {
  userTitle: "Merge check environment",
  userSummary:
    "Open Sprint validates merges in a temporary copy of your project; dependencies or tooling failed to set up correctly there.",
};

const GENERIC_ENV_FALLBACK: HumanizeEnvironmentSetupResult = {
  userTitle: "Environment setup issue",
  userSummary:
    "Something went wrong preparing the isolated environment where merge checks run. Details below may help support or debugging.",
};

/**
 * Returns user-facing title + summary for environment_setup quality-gate failures.
 * When category is not environment_setup, returns null.
 */
export function humanizeEnvironmentSetupQualityGate(
  input: HumanizeEnvironmentSetupInput
): HumanizeEnvironmentSetupResult | null {
  if (input.category !== "environment_setup") return null;

  const text = [input.reason, input.outputSnippet].filter(Boolean).join("\n");

  for (const rule of ENV_SETUP_RULES) {
    if (rule.test.test(text)) {
      return { userTitle: rule.userTitle, userSummary: rule.userSummary };
    }
  }

  if (
    input.validationWorkspace === "merged_candidate" ||
    /\bmerged_candidate\b/i.test(text) ||
    /opensprint-validation/i.test(text)
  ) {
    return MERGE_PREVIEW_FALLBACK;
  }

  return GENERIC_ENV_FALLBACK;
}
