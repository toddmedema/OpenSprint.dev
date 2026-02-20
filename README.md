# Open Sprint

**Build _good_ software at the speed of thought, and never pay for SaaS again.**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/Node.js-%3E%3D20-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

<p align="center">
  <img src="docs/assets/hero-demo.gif" alt="OpenSprint — Sketch, Plan, Execute, Evaluate, Deliver" width="800" />
</p>

Tired of _managing AI_ and just want to _build good software_? Open Sprint guides you across five phases of product development — SPEED: **Sketch**, **Plan**, **Execute**, **Evaluate**, and **Deliver** — to transform a high-level product idea into well-architected, working software with minimal manual intervention. The built-in AI orchestration layer manages a whole team of agents, from product visionaries that help you write PRDs, to coders and QA to build and test your software.

## Why Open Sprint?

Building software with AI today is **fragmented and unstructured**. Developers use AI coding assistants for individual tasks, but there is no cohesive system that manages the full journey from idea to deployed product. This leads to:

- **No architectural coherence** — AI-generated code lacks a unified vision because each prompt is handled in isolation
- **Manual orchestration overhead** — users spend time managing prompts, context windows, and task sequencing instead of making product decisions
- **No feedback loop** — there is no structured way to validate completed work and feed findings back into development
- **Tooling headaches** - using advanced AI tools currently requires deep technical familiarity with terminal commands, preventing ordinary people from participating in their full power.

Open Sprint solves this with a Product-Driven web UI that maintains context across the entire lifecycle and automates the orchestration of agents. Humans focus on _what_ to build and _why_; AI handles _how_.

_Open Sprint_: The speed of a full-out open sprint. Agile methodology sprints of quick iteration and user feedback. Open source software. And a nod to OpenAI for starting this crazy new era.

### What about Gas Town?

You've probably heard about [Gas Town](<[url](https://github.com/steveyegge/gastown)>), the original AI orchestrator.

Open Sprint takes the concept of an AI orchestrator and levels it up: now you're not working in terminals giving text-only prompts and trying to keep track of agents, you're working in a web-first workflow that gives Jira a run for its money. Brainstorm your PRD alongside an agent in a Google Docs-like interface. Track project status and provide feedback (including wonderful web features like attaching screenshots and replying inline). Once you've opened your sprint, you'll never be able to stop!

## Quick Start

```bash
git clone https://github.com/toddmedema/OpenSprint.dev.git
cd opensprint
npm install
npm run dev
```

Then open your browser to http://localhost:5173 and get building!

### Integrations

To run a team of AI agents, you'll need at least one existing agent subscription and API key. The orchestration layer is designed to work on top of any AI agent that can read prompts and return outputs, so it's BYO-AI!

We currently natively support Claude and Cursor APIs, as well as custom APIs via inputting your own CLI command that calls the agents. Please open an issue if you'd like native support for other AI providers!

## Architecture

```mermaid
flowchart LR
    A["🌙 Sketch"] -->|PRD| B["📋 Plan"]
    B -->|Epics & Tasks| C["🔨 Execute"]
    C -->|Working Code| D["✅ Evaluate"]
    D -->|Feedback| B

    style A fill:#3B82F6,color:#fff
    style B fill:#8B5CF6,color:#fff
    style C fill:#F59E0B,color:#fff
    style D fill:#10B981,color:#fff
```

| Phase        | What happens                                                                     |
| ------------ | -------------------------------------------------------------------------------- |
| **Sketch**   | Chat with AI to refine your idea into a structured Product Requirements Document |
| **Plan**     | AI decomposes the PRD into epics, tasks, and a dependency graph                  |
| **Execute**  | AI agents autonomously execute tasks with two-agent code + review cycles         |
| **Evaluate** | Submit feedback that AI categorizes and maps back to plan epics for iteration    |
| **Deliver**  | Ship your code and deliver value!                                                |

### The Agent Team

Open Sprint orchestrates a team of nine specialized agents — each responsible for a distinct part of the SPEED lifecycle:

<table>
<thead>
<tr>
  <th colspan="2">Agent</th>
  <th>Phase</th>
  <th>Description</th>
</tr>
</thead>
<tbody>
<tr>
  <td><img src="packages/frontend/public/agent-icons/dreamer.svg" width="48" height="48" alt="" align="middle" /></td>
  <td>Dreamer</td>
  <td>Sketch</td>
  <td>The wise conversationalist who refines your idea into a PRD, asking the hard questions and challenging assumptions before the journey begins.
</tr>
<tr>
  <td><img src="packages/frontend/public/agent-icons/planner.svg" width="48" height="48" alt="" align="middle" /></td>
  <td>Planner</td>
  <td>Plan</td>
  <td>The brilliant strategist who decomposes a PRD into epics, tasks, and a dependency graph — knowing every milestone and danger on the road ahead.</td>
</tr>
<tr>
  <td><img src="packages/frontend/public/agent-icons/harmonizer.svg" width="48" height="48" alt="" align="middle" /></td>
  <td>Harmonizer</td>
  <td>All</td>
  <td>The steady keeper of the central mission, quietly ensuring the PRD stays true even as implementation forces difficult compromises.</td>
</tr>
<tr>
  <td><img src="packages/frontend/public/agent-icons/analyst.svg" width="48" height="48" alt="" align="middle" /></td>
  <td>Analyst</td>
  <td>Evaluate</td>
  <td>With eyes that miss nothing, categorizes every piece of user feedback and maps it to the right epic before anyone else has processed it.</td>
</tr>
<tr>
  <td><img src="packages/frontend/public/agent-icons/summarizer.svg" width="48" height="48" alt="" align="middle" /></td>
  <td>Summarizer</td>
  <td>Execute</td>
  <td>Ever-faithful and efficient, distills assembled context down to exactly what the Coder needs — nothing more, nothing less.</td>
</tr>
<tr>
  <td><img src="packages/frontend/public/agent-icons/auditor.svg" width="48" height="48" alt="" align="middle" /></td>
  <td>Auditor</td>
  <td>Execute</td>
  <td>Surveys what has <em>actually</em> been built with unflinching honesty, then determines exactly — and only — what still needs doing.</td>
</tr>
<tr>
  <td><img src="packages/frontend/public/agent-icons/coder.svg" width="48" height="48" alt="" align="middle" /></td>
  <td>Coder</td>
  <td>Execute</td>
  <td>Full of energy and occasionally chaotic, dives into every task head-first and always ships working code with tests.</td>
</tr>
<tr>
  <td><img src="packages/frontend/public/agent-icons/reviewer.svg" width="48" height="48" alt="" align="middle" /></td>
  <td>Reviewer</td>
  <td>Execute</td>
  <td>Principled and demanding, validates every implementation against its acceptance criteria — approving only what truly serves the product.</td>
</tr>
<tr>
  <td><img src="packages/frontend/public/agent-icons/merger.svg" width="48" height="48" alt="" align="middle" /></td>
  <td>Merger</td>
  <td>Execute</td>
  <td>Clever and unflappable, steps in when rebase conflicts block the road, resolves the mess with quiet competence, and keeps the journey moving.</td>
</tr>
</tbody>
</table>

## Project Structure

```
opensprint/
├── packages/
│   ├── backend/    # Node.js + Express API server (TypeScript)
│   ├── frontend/   # React + Vite application (TypeScript, Tailwind CSS)
│   └── shared/     # Shared types and constants
├── .beads/         # Git-based issue tracker data
├── PRD.md          # Product Requirements Document
└── package.json    # Root workspace config (npm workspaces)
```

## Scripts

All scripts can be run from the project root:

| Command         | Description                                      |
| --------------- | ------------------------------------------------ |
| `npm run dev`   | Start backend + frontend concurrently            |
| `npm run build` | Build all packages (shared → backend → frontend) |
| `npm run test`  | Run tests across all packages                    |
| `npm run lint`  | Lint all packages                                |
| `npm run clean` | Remove all build artifacts and node_modules      |

## Tech Stack

| Layer              | Technologies                                                            |
| ------------------ | ----------------------------------------------------------------------- |
| **Backend**        | Node.js, Express, WebSocket (ws), TypeScript, Vitest                    |
| **Frontend**       | React 19, React Router, Vite, Tailwind CSS, TypeScript                  |
| **Shared**         | TypeScript types and constants consumed by both packages                |
| **Issue Tracking** | [Beads](https://github.com/toddmedema/beads) — git-native issue tracker |

## Prerequisites

- [Node.js](https://nodejs.org/) >= 20.0.0
- npm (included with Node.js)
- Git

## Environment Variables

| Variable                     | Default | Description                                                                                                                                                                         |
| ---------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`          | —       | API key for Claude agent integration                                                                                                                                                |
| `CURSOR_API_KEY`             | —       | API key for Cursor agent integration                                                                                                                                                |
| `PORT`                       | `3100`  | Backend server port                                                                                                                                                                 |
| `OPENSPRINT_PRESERVE_AGENTS` | unset   | When set to `1`, agent processes survive backend restarts. Automatically set in `npm run dev` so that `tsx watch` restarts don't kill running agents. Do **not** set in production. |

## Developing on OpenSprint

When using OpenSprint to develop _itself_, you should use two separate clones to avoid contention between the running server and the AI agents modifying code:

- **Control clone** — runs the backend/frontend server (`npm run dev`)
- **Dev clone** — the target repo where the orchestrator and AI agents make changes

This prevents `tsx watch` from restarting the server when agents commit code, and avoids git lock contention between your manual operations and the orchestrator's worktree management.

### Setup

```bash
# 1. Clone a second copy as the development target
git clone <your-origin-url> ~/opensprint-dev
cd ~/opensprint-dev && npm install

# 2. Copy project state from the control clone
cp -r /path/to/control-clone/.opensprint ~/opensprint-dev/.opensprint
cp /path/to/control-clone/.env ~/opensprint-dev/.env

# 3. Update the project's repoPath (via API or direct edit)
#    Option A — API (while server is running):
curl -X PUT http://localhost:3100/api/v1/projects/<PROJECT_ID> \
  -H 'Content-Type: application/json' \
  -d '{"repoPath": "/Users/you/opensprint-dev"}'

#    Option B — edit ~/.opensprint/projects.json directly
```

### Daily workflow

- Run `npm run dev` from the **control clone** only
- The orchestrator creates git worktrees from the **dev clone** and runs agents there
- Run `bd` commands from `~/opensprint-dev` (that's where `.beads/` lives)
- After agents push changes, `git pull` in the control clone to pick them up

## Contributing

Contributions are welcome! Whether it's a bug report, feature request, or pull request — all input is appreciated.

1. **Fork** the repository
2. **Create a branch** for your feature or fix: `git checkout -b my-feature`
3. **Make your changes** and add tests where appropriate
4. **Run the test suite**: `npm test`
5. **Submit a pull request**

### Issue Tracking with Beads

This project uses [Beads](https://github.com/toddmedema/beads) (`bd`) for task and issue tracking. Run `bd onboard` to get started, then `bd ready` to find available work.

### Reporting Bugs

Open a [GitHub Issue](https://github.com/toddmedema/opensprint/issues) with:

- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Node version, browser)

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE) — you are free to use, modify, and distribute it, but derivative works must remain open source under the same license.
