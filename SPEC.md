# Product Specification

## Executive Summary

Open Sprint is a web application that guides users through the complete software development lifecycle using AI agents. It provides a structured, five-phase workflow — **SPEED**: Sketch, Plan, Execute, Evaluate, and Deliver — that transforms high-level product ideas into working software with minimal manual intervention.

The platform pairs a browser-based interface with a background agent CLI, enabling AI to autonomously execute development tasks while keeping the user in control of strategy and direction. The core philosophy is that humans should focus on _what_ to build and _why_, while AI handles _how_ to build it.

Open Sprint supports multiple agent backends (Claude, Cursor, OpenAI, LM Studio for local models, and custom CLI agents), comprehensive automated testing including end-to-end and integration tests, configurable human-in-the-loop thresholds, and full offline operation for users with local agent setups (including LM Studio).

## Problem Statement

Building software with AI today is fragmented and unstructured. Developers use AI coding assistants for individual tasks, but there is no cohesive system that manages the full journey from idea to deployed product. This leads to several persistent problems:

- **Lack of architectural coherence:** AI-generated code often lacks a unified vision because each prompt is handled in isolation, without awareness of the broader system design.
- **No dependency tracking:** When building features in parallel, there is no mechanism to ensure that work on one feature accounts for dependencies on another.
- **Manual orchestration overhead:** Users spend significant time managing prompts, context windows, and task sequencing rather than focusing on product decisions.
- **No feedback loop:** There is no structured way to validate completed work and feed findings back into the development process.

Open Sprint solves these problems by providing an end-to-end platform that maintains context across the entire lifecycle and automates the orchestration of AI development agents.

## User Personas

### The Product-Minded Founder

A non-technical founder with a clear product vision who wants to build an MVP without hiring a development team. They understand what they want to build but need AI to handle the engineering. They value speed, clear communication about what is being built, and the ability to provide feedback without writing code.

### The Solo Developer

An experienced developer who wants to multiply their output. They can code but want to delegate routine implementation to AI while focusing on architecture and product decisions. They value transparency into what the AI is doing, the ability to intervene when needed, and high-quality code output.

### The Agency / Consultancy

A small team that builds software for clients. They need to move quickly from client requirements to working software, maintain multiple projects simultaneously, and provide clients with visibility into progress. They value the structured workflow for client communication and the ability to run multiple projects in parallel.

## Goals and Success Metrics

### Primary Goals

1. Reduce the time from idea to working prototype by 10x compared to traditional AI-assisted development workflows.
2. Enable non-engineers to ship production-quality software by handling technical complexity behind the scenes.
3. Maintain architectural coherence across an entire project by flowing design decisions through every phase.
4. Create a self-improving development flywheel where validation feedback automatically triggers corrective action.

### Success Metrics

| Metric                                | Target                                     | Measurement Method                 |
| ------------------------------------- | ------------------------------------------ | ---------------------------------- |
| Time from idea to working prototype   | < 1 day for standard web apps              | End-to-end session timing          |
| User intervention rate during Execute | < 10% of tasks require manual input        | Task completion telemetry          |
| Sketch-to-code fidelity               | > 90% alignment with PRD                   | Automated PRD compliance checks    |
| Feedback loop closure time            | < 30 min from bug report to fix deployed   | Evaluate-to-Execute cycle tracking |
| First-time user task completion       | > 80% complete a full Sketch-Execute cycle | Onboarding funnel analytics        |
| Test coverage                         | > 80% code coverage with passing E2E tests | Automated coverage reporting       |

**Coverage enforcement in CI:** The merge gate (`.github/workflows/merge-gate.yml`) runs `npm run test:coverage` for the shared, backend, and frontend workspaces. Vitest is configured with coverage thresholds (backend 75%, frontend 70%); the CI job fails if any workspace is below its threshold. The SPEC target of >80% remains the long-term goal.

## Feature List

Add under Execute phase:

- **Repository dependency integrity preflight:** Before agent execution, run a fast dependency health check (`npm ls --depth=0`, or `--workspaces` for workspace roots). If unhealthy, run one auto-repair attempt (`npm ci`) and re-check; if still unhealthy, stop execution with explicit remediation steps.
- **Quality-gate environment auto-repair:** During pre-merge quality gates, detect environment/setup fingerprints (for example `MODULE_NOT_FOUND`, missing `node_modules`, native addon load errors), run one repair attempt (`npm ci` + worktree `node_modules` re-symlink), and re-run the failed gate once.
- **Environment-aware failure policy:** Classify deterministic environment failures as `repo_preflight` or `environment_setup` and block/pause with remediation guidance instead of repeatedly requeueing coding attempts.
- **Actionable diagnostics-first failures:** For quality-gate and test failures, surface primary diagnostics as `failed command + first compiler/test error`, with expandable structured details for deeper troubleshooting.

## Technical Architecture

**Repo preflight and dependency integrity**

- Extend preflight to run dependency integrity checks after existing repository setup checks.
- Implement a dependency health routine in branch/worktree management that:
  - runs `npm ls --depth=0` (or `npm ls --depth=0 --workspaces` when workspace config is detected),
  - performs one remediation attempt with `npm ci` on failure,
  - re-runs integrity check,
  - throws `RepoPreflightError` with remediation commands when still unhealthy.
- Skip dependency integrity checks when no `package.json` is present.

**Quality-gate failure handling**

- In merge quality gates, detect env/setup failure fingerprints from command output.
- On match, perform exactly one repair cycle (`npm ci` + `symlinkNodeModules`) and retry the failed gate once.
- Avoid infinite repair loops; if retry fails, proceed with standard gate failure handling.
- Classify as environment/setup failure only when the retry failure still matches env fingerprints.

**Failure classification and diagnostics**

- Add `environment_setup` as a first-class failure type alongside `repo_preflight` where failure policy is applied.
- Route deterministic env/setup failures to block/pause with remediation text rather than repeated requeue behavior.
- Build user-visible failure summaries from structured gate data, prioritizing failed command plus first meaningful compiler/test error line.

## Data Model

Add optional structured failure detail fields for quality-gate and merge failures.

- **Task metadata (`extra`)** may include:
  - `failedGateCommand`
  - `failedGateReason`
  - `failedGateOutputSnippet`
  - `worktreePath`
  - optional environment classification marker (for example `environmentSetup: true` or equivalent subtype field)
- **Event log payloads** for `merge.failed`, `task.requeued`, and `task.blocked` may include the same structured fields to preserve actionable diagnostics in history and notifications.
- **Failure type model** recognizes `environment_setup` for deterministic setup failures after repair attempts.
- No schema migration is required when these values are stored in existing extensible JSON fields.

## API Contracts

No new REST endpoints are required.

- Existing task/execution diagnostics responses should expose structured quality-gate failure detail when present, either as a dedicated object (for example `qualityGateDetail`) or embedded in existing diagnostic payloads.
- Structured detail should carry at least:
  - `failedGateCommand`
  - `failedGateReason`
  - `failedGateOutputSnippet`
  - `worktreePath`
- Event-stream payloads (including `merge.failed`, `task.requeued`, `task.blocked`) should include these fields in `data` so real-time UI and notifications can show actionable diagnostics.
- Backward compatibility requirement: consumers must ignore unknown fields.

## Non-Functional Requirements

| Category    | Requirement                                                                                                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reliability | Deterministic repository/environment failures must fail fast and block with remediation after at most one automated repair attempt; avoid repeated requeue loops for setup issues. |
| Performance | Dependency integrity preflight must use a fast check (`npm ls`) with bounded timeout (target 15-30s) before agent execution.                                                       |
| Usability   | Failure messaging for quality-gate/test failures must prioritize actionable diagnostics (failed command + first compiler/test error) with optional expanded detail.                |
| Operability | Structured failure details must be persisted in task/event diagnostics to support debugging, notifications, and post-mortem analysis.                                              |

## Open Questions

All previously identified questions have been resolved and documented in the Resolved Decisions section of the full PRD. No open questions at this time.

## Competitive Landscape

### Overview

Open Sprint sits in the “AI-assisted product development” space. Alternatives range from no-code chat-to-app builders to IDE-centric coding agents. The comparison below focuses on full-lifecycle and “idea to working product” tools rather than single-step UI generators (e.g. v0, Locofy).

### Lovable (lovable.dev)

- **Positioning:** No-code app builder; “build apps and websites by chatting with AI.”
- **Strengths:** Fast iteration, low friction for non-engineers, chat-first UX.
- **Limitations:** Centered on UI/app generation from conversation; no explicit PRD/spec phase, no dependency-aware task graph or Evaluate → Execute feedback loop. Tied to their hosted experience.
- **Open Sprint differentiator:** Full SPEED lifecycle with a written spec (SPEC.md), dependency-aware planning, human-in-the-loop, and optional use of your repo + local or custom agents (including offline).

### Bolt (bolt.new)

- **Positioning:** “Vibe coding” and professional coding agents; chat-to-build with integrated frontier models, testing/refactoring, and Bolt Cloud (hosting, DB, auth, SEO).
- **Strengths:** Single UI for multiple AI backends, built-in testing and iteration, cloud backend and scaling story.
- **Limitations:** Emphasis on “build in one place” with their stack; less focus on a formal spec phase or on flowing a single PRD through plan → execute → evaluate. Primarily cloud-hosted.
- **Open Sprint differentiator:** SPEC.md as the single source of truth, explicit Sketch → Plan → Execute → Evaluate → Deliver workflow, worktree/branch-based workflow with merger handling, and ability to run fully offline with LM Studio or other local agents.

### Gas Town (gastown.io)

- **Positioning:** AI-powered product or development workflow tool in the idea-to-ship space.
- **Open Sprint differentiator:** Open Sprint emphasizes a phased lifecycle (Sketch/Plan/Execute/Evaluate/Deliver), a file-based spec at repo root, and orchestration that respects task dependencies and feedback loops rather than ad-hoc prompting.

### Other Adjacent Tools

- **Cursor / IDE coding assistants:** Strong for in-editor coding; they do not provide a shared PRD, multi-phase workflow, or structured Evaluate → Execute loop.
- **Replit Agent, etc.:** Often centered on in-environment generation and deployment; typically no first-class spec or dependency-aware task orchestration.

### Summary Table

| Dimension          | Open Sprint                                    | Lovable / Bolt-style builders      |
| ------------------ | ---------------------------------------------- | ---------------------------------- |
| Spec / PRD         | SPEC.md at repo root; first-class phase        | Implicit or lightweight            |
| Lifecycle          | Sketch → Plan → Execute → Evaluate → Deliver   | Chat → build (and optionally ship) |
| Task orchestration | Dependency-aware, priority-ordered tasks       | Largely prompt/session-driven      |
| Feedback loop      | Evaluate maps to tasks; fixes re-enter Execute | Manual or tool-specific            |
| Agent choice       | Claude, Cursor, OpenAI, LM Studio, custom CLI  | Typically vendor’s models/hosted   |
| Offline            | Supported (e.g. LM Studio)                     | Generally requires cloud           |
| Repo / Git         | Works with existing repos; worktree + merger   | Often tied to platform repos       |
