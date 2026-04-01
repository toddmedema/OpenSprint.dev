import { isProcessAlive, signalProcessGroup } from "../../utils/process-group.js";
import type { CodingAgentHandle } from "./agent-types.js";

/** Create a handle for a detached agent process group after backend restart. */
export function createProcessGroupHandle(processGroupLeaderPid: number): CodingAgentHandle {
  return {
    pid: processGroupLeaderPid,
    kill() {
      try {
        signalProcessGroup(processGroupLeaderPid, "SIGTERM");
      } catch {
        // Process may already be dead
        return;
      }

      const killTimer = setTimeout(() => {
        if (!isProcessAlive(processGroupLeaderPid)) return;
        try {
          signalProcessGroup(processGroupLeaderPid, "SIGKILL");
        } catch {
          // Process may already be dead
        }
      }, 5000);
      killTimer.unref?.();
    },
  };
}
