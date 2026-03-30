import type { EnvRuntimeResponse, ScaffoldTemplate } from "@opensprint/shared";

function quotePath(repoPath: string): string {
  return `"${repoPath.replace(/"/g, '\\"')}"`;
}

export function getRunInstructions(
  repoPath: string,
  runtime: EnvRuntimeResponse,
  template?: ScaffoldTemplate
): string[] {
  const quotedPath = quotePath(repoPath);
  const cdCmd =
    runtime.platform === "win32" && !runtime.isWsl ? `pushd ${quotedPath}` : `cd ${quotedPath}`;

  if (template === "empty") {
    return [cdCmd];
  }

  return [cdCmd, "npm run web"];
}
