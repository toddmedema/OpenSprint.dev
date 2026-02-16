/** OpenSprint directory within project repos */
export const OPENSPRINT_DIR = '.opensprint';

/** Paths within the .opensprint directory */
export const OPENSPRINT_PATHS = {
  prd: `${OPENSPRINT_DIR}/prd.json`,
  plans: `${OPENSPRINT_DIR}/plans`,
  conversations: `${OPENSPRINT_DIR}/conversations`,
  sessions: `${OPENSPRINT_DIR}/sessions`,
  feedback: `${OPENSPRINT_DIR}/feedback`,
  active: `${OPENSPRINT_DIR}/active`,
  settings: `${OPENSPRINT_DIR}/settings.json`,
  orchestratorState: `${OPENSPRINT_DIR}/orchestrator-state.json`,
} as const;

/** Global project index path */
export const PROJECT_INDEX_PATH = '~/.opensprint/projects.json';

/** Agent timeout in milliseconds (5 minutes of inactivity) */
export const AGENT_INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;

/** @deprecated Use BACKOFF_FAILURE_THRESHOLD with progressive backoff (PRDv2 §9.1) */
export const DEFAULT_RETRY_LIMIT = 2;

/** Number of consecutive failures before priority demotion (PRDv2 §9.1) */
export const BACKOFF_FAILURE_THRESHOLD = 3;

/** Maximum beads priority value; tasks at this level get blocked on next demotion (PRDv2 §9.1) */
export const MAX_PRIORITY_BEFORE_BLOCK = 4;

/** Default API port */
export const DEFAULT_API_PORT = 3100;

/** Default WebSocket path */
export const WS_PATH = '/ws';

/** API version prefix */
export const API_PREFIX = '/api/v1';

/** Kanban columns in display order */
export const KANBAN_COLUMNS = [
  'planning',
  'backlog',
  'ready',
  'in_progress',
  'in_review',
  'done',
] as const;

/** Plan complexity options */
export const PLAN_COMPLEXITIES = ['low', 'medium', 'high', 'very_high'] as const;

/** Task priority labels */
export const PRIORITY_LABELS: Record<number, string> = {
  0: 'Critical',
  1: 'High',
  2: 'Medium',
  3: 'Low',
  4: 'Lowest',
};

/** Test framework options for setup (PRD §8.3, §10.2) */
export const TEST_FRAMEWORKS = [
  { id: 'jest', label: 'Jest', command: 'npm test' },
  { id: 'vitest', label: 'Vitest', command: 'npx vitest run' },
  { id: 'playwright', label: 'Playwright', command: 'npx playwright test' },
  { id: 'cypress', label: 'Cypress', command: 'npx cypress run' },
  { id: 'pytest', label: 'pytest', command: 'pytest' },
  { id: 'mocha', label: 'Mocha', command: 'npm test' },
  { id: 'none', label: 'None / Configure later', command: '' },
] as const;

/** Get test command for a framework id, or empty string for none */
export function getTestCommandForFramework(framework: string | null): string {
  if (!framework || framework === 'none') return '';
  const found = TEST_FRAMEWORKS.find((f) => f.id === framework);
  return found?.command ?? '';
}
