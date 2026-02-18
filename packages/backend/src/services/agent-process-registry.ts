/**
 * Tracks spawned agent child processes so they can be killed on backend shutdown.
 * Prevents orphaned zombie processes when the backend restarts (e.g. tsx watch).
 */

const trackedPids = new Set<number>();
/** Process group IDs (negative PIDs) for detached spawns that use process groups */
const trackedProcessGroups = new Set<number>();

export function registerAgentProcess(pid: number, options?: { processGroup?: boolean }): void {
  if (options?.processGroup && pid > 0) {
    trackedProcessGroups.add(-pid);
  } else {
    trackedPids.add(pid);
  }
}

export function unregisterAgentProcess(pid: number, options?: { processGroup?: boolean }): void {
  if (options?.processGroup && pid > 0) {
    trackedProcessGroups.delete(-pid);
  } else {
    trackedPids.delete(pid);
  }
}

/**
 * Kill all tracked agent processes. Called on backend SIGTERM/SIGINT.
 */
export function killAllTrackedAgentProcesses(): void {
  for (const pgid of trackedProcessGroups) {
    try {
      process.kill(pgid, "SIGTERM");
    } catch {
      /* process already exited */
    }
  }
  trackedProcessGroups.clear();

  for (const pid of trackedPids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* process already exited */
    }
  }
  trackedPids.clear();
}
