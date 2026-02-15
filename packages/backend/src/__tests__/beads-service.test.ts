import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BeadsService } from '../services/beads.service.js';

let mockExecResolve: { stdout: string; stderr: string } = { stdout: '', stderr: '' };
let mockExecReject: Error & { stderr?: string } | null = null;

vi.mock('util', () => ({
  promisify: vi.fn(() => {
    return () =>
      mockExecReject ? Promise.reject(mockExecReject) : Promise.resolve(mockExecResolve);
  }),
}));

vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

describe('BeadsService', () => {
  let beads: BeadsService;
  const repoPath = '/tmp/test-repo';

  beforeEach(() => {
    beads = new BeadsService();
    mockExecResolve = { stdout: '', stderr: '' };
    mockExecReject = null;
  });

  it('should be instantiable', () => {
    expect(beads).toBeInstanceOf(BeadsService);
  });

  it('should have all expected methods', () => {
    expect(typeof beads.init).toBe('function');
    expect(typeof beads.create).toBe('function');
    expect(typeof beads.update).toBe('function');
    expect(typeof beads.close).toBe('function');
    expect(typeof beads.ready).toBe('function');
    expect(typeof beads.list).toBe('function');
    expect(typeof beads.show).toBe('function');
    expect(typeof beads.addDependency).toBe('function');
    expect(typeof beads.delete).toBe('function');
    expect(typeof beads.sync).toBe('function');
    expect(typeof beads.depTree).toBe('function');
    expect(typeof beads.runBd).toBe('function');
  });

  it('runBd should return parsed JSON from bd output', async () => {
    const json = { id: 'test-1', title: 'Test', status: 'open' };
    mockExecResolve = { stdout: JSON.stringify(json), stderr: '' };

    const result = await beads.runBd(repoPath, 'show', ['test-1', '--json']);
    expect(result).toEqual(json);
  });

  it('runBd should return null for empty output', async () => {
    mockExecResolve = { stdout: '\n  \n', stderr: '' };

    const result = await beads.runBd(repoPath, 'close', ['x', '--reason', 'done', '--json']);
    expect(result).toBeNull();
  });

  it('runBd should throw on exec error', async () => {
    mockExecReject = Object.assign(new Error('bd not found'), {
      stderr: 'bd: command not found',
    });

    await expect(beads.runBd(repoPath, 'list', ['--json'])).rejects.toThrow(/Beads command failed/);
  });
});
