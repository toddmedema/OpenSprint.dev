# OpenSprint

AI-powered platform that guides you through the full software development lifecycle — from idea to working software. OpenSprint orchestrates AI agents across four phases: **Dream**, **Plan**, **Build**, and **Verify**.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 20.0.0
- npm (included with Node.js)
- Git

## Project Structure

```
opensprint.dev/
├── packages/
│   ├── backend/    # Node.js + Express API server (TypeScript)
│   ├── frontend/   # React + Vite application (TypeScript, Tailwind CSS)
│   └── shared/     # Shared types and constants
├── .beads/         # Git-based issue tracker data
├── PRD.md          # Product Requirements Document
└── package.json    # Root workspace config
```

This is an npm workspaces monorepo with three packages that share a common TypeScript configuration.

## Getting Started

```bash
# Install all dependencies
npm install

# Start both backend and frontend in development mode
npm run dev
```

The app will be available at:

| Service   | URL                    |
| --------- | ---------------------- |
| Frontend  | http://localhost:5173  |
| Backend   | http://localhost:3100  |
| WebSocket | ws://localhost:3100/ws |

## Scripts

All scripts can be run from the project root:

| Command                | Description                                      |
| ---------------------- | ------------------------------------------------ |
| `npm run dev`          | Start backend + frontend concurrently            |
| `npm run dev:backend`  | Start backend only (with hot reload)             |
| `npm run dev:frontend` | Start frontend only (Vite dev server)            |
| `npm run build`        | Build all packages (shared → backend → frontend) |
| `npm run test`         | Run tests across all packages                    |
| `npm run lint`         | Lint all packages                                |
| `npm run clean`        | Remove all build artifacts and node_modules      |

## Tech Stack

**Backend:** Node.js, Express, WebSocket (ws), TypeScript, Vitest

**Frontend:** React 19, React Router, Vite, Tailwind CSS, TypeScript

**Shared:** TypeScript types and constants consumed by both backend and frontend

## License

Private — not licensed for redistribution.
