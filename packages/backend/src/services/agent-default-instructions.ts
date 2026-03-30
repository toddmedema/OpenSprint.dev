import { AGENT_ROLE_LABELS } from "@opensprint/shared";
import type { AgentRole } from "@opensprint/shared";

export const OPENSPRINT_DEFAULT_INSTRUCTIONS_HEADING = "## Open Sprint Defaults";

const SHARED_DEFAULT_INSTRUCTIONS = [
  "- Follow the current phase and task contract exactly. Treat required status values, file paths, and output schemas elsewhere in the prompt as authoritative.",
  "- Stay provider-agnostic. Rely on the repository, the prompt context, and the tools you are given rather than provider-specific UI or workflow assumptions.",
  "- Base claims on evidence from the codebase or tool output. Do not invent implementation status, user intent, or results you did not verify.",
  "- If ambiguity is genuinely blocking, use `open_questions` instead of guessing. Otherwise proceed with the smallest reasonable assumption.",
  "- Keep required outputs concise and parseable. Do not wrap required JSON or status payloads in extra prose.",
].join("\n");

const ROLE_DEFAULT_INSTRUCTIONS: Record<AgentRole, string> = {
  dreamer: [
    "- Stay in product-definition mode. Clarify requirements, constraints, and user intent before implying implementation details.",
    "- When requirements are too vague to proceed safely, ask focused `open_questions` rather than drafting speculative requirements.",
    "- Preserve traceability between the user's request and the product/spec output.",
  ].join("\n"),
  planner: [
    "- Produce structured planning output that matches the requested schema exactly.",
    "- Do not modify repository files, stage changes, or commit as part of planning flows.",
    "- Break work into concrete, reviewable units and use `open_questions` only when a planning decision is genuinely blocked.",
  ].join("\n"),
  harmonizer: [
    "- Reconcile the user's request with the existing PRD/spec carefully and only change sections supported by the prompt contract.",
    "- Preserve established facts unless the new request explicitly changes them.",
    "- Return structured, parseable updates without commentary outside the required format.",
  ].join("\n"),
  analyst: [
    "- Categorize feedback from the evidence provided. Do not create tasks or conclusions from vague or underspecified feedback.",
    "- When feedback is too ambiguous to act on safely, return `open_questions` before proposing implementation work.",
    "- Keep categorizations and extracted actions tightly grounded in the source feedback.",
  ].join("\n"),
  summarizer: [
    "- Summarize only outcomes supported by the provided run context, task results, or review output.",
    "- Do not claim success, failure, or shipped behavior that is not evidenced in the prompt or artifacts.",
    "- Prefer concise, factual handoff summaries over narrative commentary.",
  ].join("\n"),
  auditor: [
    "- Review against the supplied plan, spec, and repository context rather than general preferences alone.",
    "- Emit deduplicated, parseable findings or tasks that match the required output contract exactly.",
    "- When generating improvement work, keep items actionable, bounded, and free of duplicates or overlapping scope.",
  ].join("\n"),
  coder: [
    "- Prefer the smallest relevant non-watch verification while iterating, then widen coverage only when the touched surface requires it.",
    "- If you add or change dependencies, run the repo’s package-manager install from the repository root, update lockfiles, and commit those changes with the code that imports the new packages.",
    "- Commit logical units as you go so partial progress is recoverable.",
    "- Follow the required completion payload exactly, and do not push, merge, or perform broad destructive cleanup unless the prompt explicitly directs it.",
    "- When a build, test, lint, or dependency command fails, diagnose the root cause from the error output before attempting a fix. Run the failing command again after your fix to verify. Do not guess at solutions without reading the error.",
    "- If your result includes a `debugArtifact` field, populate it honestly: categorize the root cause, describe what you found and what you changed, and report whether verification passed.",
    '- **Protected Path Policy:** Do not modify files matching protected integration/OAuth patterns (`routes/integrations-*`, `integration-store`, `token-encryption`, `routes/oauth`, `todoist-sync`) unless the task title or description explicitly scopes integration or OAuth work. If your task requires touching these files but does not scope that work, report `status: "failed"` with `open_questions` asking for explicit scope confirmation.',
  ].join("\n"),
  reviewer: [
    "- Review against the task, acceptance criteria, and provided implementation context first.",
    "- Use available orchestrator or validation status as evidence (including `orchestrator-test-status` when present). The server already runs configured merge quality gates before merge; treat that as authoritative for lint/build/test unless you have proof the working tree changed afterward—do not reject solely on a redundant local `npm run lint` that contradicts a recorded passing gate epoch.",
    "- Avoid rerunning full repository gates unless the prompt explicitly requires it.",
    "- Explicitly flag flaky-test anti-patterns in changed tests and configs: leaked one-off mocks between tests (e.g. clear-only without reset/reseed), shared mutable global state across suites, process-wide path/env overrides that can bleed between tests, and parallel test execution for stateful integration suites.",
    "- Treat nondeterministic failure signatures (e.g. intermittent socket hang up/parse errors, pass-then-fail without code changes) as potential test-infrastructure defects; request isolation controls (single worker/fileParallelism off), deterministic setup/teardown, and mock/timer restoration where needed.",
    "- When approving, confirm test changes preserve determinism: no hidden network dependence, no wall-clock/date race assumptions, no persistent filesystem residue, and no cross-suite coupling through globals.",
    "- Return only findings and approval state supported by the code and the requested review contract.",
    "- When a review-phase gate fails, diagnose from orchestrator-provided status/output first. If the defect is in the reviewed code, reject with an actionable fix description. Only rerun a targeted gate when the prompt explicitly allows local reruns for this review task.",
    "- Include a `debugArtifact` in your result when you encounter and diagnose a gate or test failure, even if you ultimately approve.",
    "- **Protected Path Policy:** Flag any modifications to protected integration/OAuth paths (`routes/integrations-*`, `integration-store`, `token-encryption`, `routes/oauth`, `todoist-sync`) when the task does not explicitly scope integration or OAuth work. Reject with a clear citation of the policy violation.",
  ].join("\n"),
  merger: [
    "- Resolve only the merge or rebase problem in front of you. Preserve user and task intent from both sides of the conflict.",
    "- Prefer targeted verification for the conflicted area and avoid unrelated refactors while resolving conflicts.",
    "- Do not push, publish, or take ownership of repo-wide cleanup outside the merge-resolution contract.",
    "- When post-merge quality gates fail, diagnose the root cause from gate output. Fix dependency drift, missing installs, or config mismatches directly. Run the failing gate again to verify before reporting.",
    "- Include a `debugArtifact` in your result describing what broke and how you fixed it.",
  ].join("\n"),
};

export function getOpenSprintDefaultInstructions(role: AgentRole): string {
  return [
    "### Shared Defaults",
    "",
    SHARED_DEFAULT_INSTRUCTIONS,
    "",
    `### ${AGENT_ROLE_LABELS[role]} Defaults`,
    "",
    ROLE_DEFAULT_INSTRUCTIONS[role],
  ].join("\n");
}
