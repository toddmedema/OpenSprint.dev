import path from "path";

type ParsedNvmVersion = {
  major: number;
  minor: number;
  patch: number;
};

function parseNvmNodeVersion(entry: string): ParsedNvmVersion | null {
  const normalized = entry.replace(/\\/g, "/");
  const match = normalized.match(/(?:^|\/)\.nvm\/versions\/node\/v(\d+)\.(\d+)\.(\d+)\/bin\/?$/i);
  if (!match) return null;

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareDesc(a: ParsedNvmVersion, b: ParsedNvmVersion): number {
  if (a.major !== b.major) return b.major - a.major;
  if (a.minor !== b.minor) return b.minor - a.minor;
  return b.patch - a.patch;
}

/**
 * Reorder NVM-managed Node bin entries in PATH so the newest Node version wins resolution.
 * Keeps all non-NVM entries in their existing positions.
 */
export function prioritizeNewestNvmNodeInPath(pathValue: string | undefined): string | undefined {
  if (!pathValue || !pathValue.trim()) return pathValue;

  const delimiter = path.delimiter;
  const entries = pathValue.split(delimiter);
  const nvmEntries = entries
    .map((entry) => ({ entry, version: parseNvmNodeVersion(entry) }))
    .filter((item): item is { entry: string; version: ParsedNvmVersion } => item.version !== null);

  if (nvmEntries.length < 2) return pathValue;

  const sortedNvmEntries = [...nvmEntries].sort((a, b) => compareDesc(a.version, b.version));
  let nvmIndex = 0;

  const rebuilt = entries.map((entry) => {
    if (!parseNvmNodeVersion(entry)) return entry;
    const replacement = sortedNvmEntries[nvmIndex];
    nvmIndex += 1;
    return replacement?.entry ?? entry;
  });

  return rebuilt.join(delimiter);
}

/**
 * Return a cloned env object with PATH normalized for agent subprocesses.
 * Prevents older NVM Node versions from shadowing newer ones.
 */
export function normalizeSpawnEnvPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const cloned: NodeJS.ProcessEnv = { ...env };
  cloned.PATH = prioritizeNewestNvmNodeInPath(cloned.PATH);
  return cloned;
}
