import {
  ensureBaseBranchExists,
  ensureGitIdentityConfigured,
  inspectGitRepoState,
} from "../../utils/git-repo-state.js";

export async function prepareRepoForProject(
  repoPath: string,
  preferredBaseBranch?: string
): Promise<{ hadHead: boolean; baseBranch: string }> {
  const repoState = await inspectGitRepoState(repoPath, preferredBaseBranch);
  await ensureGitIdentityConfigured(repoPath);
  const baseBranch = repoState.baseBranch;
  await ensureBaseBranchExists(repoPath, baseBranch);
  return { hadHead: repoState.hasHead, baseBranch };
}
