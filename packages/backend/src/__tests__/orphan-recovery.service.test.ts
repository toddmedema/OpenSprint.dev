import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { OrphanRecoveryService } from '../services/orphan-recovery.service.js';

const execAsync = promisify(exec);

// Mock BeadsService
let mockListInProgress: { id: string; status: string; assignee: string }[] = [];
let mockUpdateCalls: Array<{ id: string; status: string; assignee: string }> = [];

vi.mock('../services/beads.service.js', () => ({
  BeadsService: vi.fn().mockImplementation(() => ({
    listInProgressWithAgentAssignee: vi.fn().mockImplementation(() => Promise.resolve(mockListInProgress)),
    update: vi.fn().mockImplementation(async (_repo: string, id: string, opts: { status?: string; assignee?: string }) => {
      mockUpdateCalls.push({ id, status: opts.status ?? '', assignee: opts.assignee ?? '' });
      return { id, status: opts.status ?? 'open', assignee: opts.assignee ?? '' };
    }),
  })),
}));

describe('OrphanRecoveryService', () => {
  let service: OrphanRecoveryService;
  let repoPath: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    service = new OrphanRecoveryService();
    repoPath = path.join(os.tmpdir(), `orphan-recovery-test-${Date.now()}`);
    await fs.mkdir(repoPath, { recursive: true });
    await execAsync('git init', { cwd: repoPath });
    await execAsync('git branch -M main', { cwd: repoPath });
    await execAsync('git config user.email "test@test.com"', { cwd: repoPath });
    await execAsync('git config user.name "Test"', { cwd: repoPath });
    await fs.mkdir(path.join(repoPath, '.beads'), { recursive: true });
    await fs.writeFile(path.join(repoPath, '.beads', 'issues.jsonl'), '[]');
    mockListInProgress = [];
    mockUpdateCalls = [];
  });

  afterEach(async () => {
    try {
      await fs.rm(repoPath, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('should recover orphaned tasks and reset to open', async () => {
    mockListInProgress = [
      { id: 'task-orphan-1', status: 'in_progress', assignee: 'agent-1' },
    ];

    const { recovered } = await service.recoverOrphanedTasks(repoPath);

    expect(recovered).toEqual(['task-orphan-1']);
    expect(mockUpdateCalls).toHaveLength(1);
    expect(mockUpdateCalls[0]).toMatchObject({
      id: 'task-orphan-1',
      status: 'open',
      assignee: '',
    });
  });

  it('should exclude task when excludeTaskId is provided', async () => {
    mockListInProgress = [
      { id: 'task-a', status: 'in_progress', assignee: 'agent-1' },
      { id: 'task-b', status: 'in_progress', assignee: 'agent-1' },
    ];

    const { recovered } = await service.recoverOrphanedTasks(repoPath, 'task-a');

    expect(recovered).toEqual(['task-b']);
    expect(mockUpdateCalls).toHaveLength(1);
    expect(mockUpdateCalls[0].id).toBe('task-b');
  });

  it('should return empty when no orphaned tasks', async () => {
    mockListInProgress = [];

    const { recovered } = await service.recoverOrphanedTasks(repoPath);

    expect(recovered).toEqual([]);
    expect(mockUpdateCalls).toHaveLength(0);
  });

  it('should commit WIP on task branch when branch exists and has uncommitted changes', async () => {
    mockListInProgress = [{ id: 'task-wip', status: 'in_progress', assignee: 'agent-1' }];
    await execAsync('git checkout -b opensprint/task-wip', { cwd: repoPath });
    await fs.writeFile(path.join(repoPath, 'newfile'), 'partial work');

    const { recovered } = await service.recoverOrphanedTasks(repoPath);

    expect(recovered).toContain('task-wip');
    const { stdout } = await execAsync('git log -1 --oneline', { cwd: repoPath });
    expect(stdout).toContain('WIP: task-wip');
  });

  it('should log warning when recovering orphaned tasks', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockListInProgress = [{ id: 'task-1', status: 'in_progress', assignee: 'agent-1' }];

    await service.recoverOrphanedTasks(repoPath);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Recovered 1 orphaned task(s)'),
    );
    warnSpy.mockRestore();
  });
});
