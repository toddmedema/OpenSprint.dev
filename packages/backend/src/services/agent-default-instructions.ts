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
    "- Commit logical units as you go so partial progress is recoverable.",
    "- Follow the required completion payload exactly, and do not push, merge, or perform broad destructive cleanup unless the prompt explicitly directs it.",
  ].join("\n"),
  reviewer: [
    "- Review against the task, acceptance criteria, and provided implementation context first.",
    "- Use available orchestrator or validation status as evidence, and avoid rerunning full repository gates unless the prompt explicitly requires it.",
    "- Return only findings and approval state supported by the code and the requested review contract.",
  ].join("\n"),
  merger: [
    "- Resolve only the merge or rebase problem in front of you. Preserve user and task intent from both sides of the conflict.",
    "- Prefer targeted verification for the conflicted area and avoid unrelated refactors while resolving conflicts.",
    "- Do not push, publish, or take ownership of repo-wide cleanup outside the merge-resolution contract.",
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
