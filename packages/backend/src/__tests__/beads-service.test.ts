import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { BeadsService } from '../services/beads.service.js';

const execAsync = promisify(exec);

describe('BeadsService', () => {
  let beads: BeadsService;

  beforeEach(() => {
    beads = new BeadsService();
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
  });

  it('init should initialize beads in repoPath', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'beads-init-test-'));
    try {
      await execAsync('git init', { cwd: tempDir });
      await beads.init(tempDir);
      const beadsDir = path.join(tempDir, '.beads');
      const stat = await fs.stat(beadsDir);
      expect(stat.isDirectory()).toBe(true);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }, 10000);

  it('create should create issue with title, type, priority and return parsed result', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'beads-create-test-'));
    try {
      await execAsync('git init', { cwd: tempDir });
      await beads.init(tempDir);
      const result = await beads.create(tempDir, 'My Task', { type: 'task', priority: 1 });
      expect(result.id).toBeDefined();
      expect(result.title).toBe('My Task');
      expect(result.issue_type ?? result.type).toBe('task');
      expect(result.status).toBe('open');
      expect(result.priority).toBe(1);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }, 10000);

  it('create should support description and parentId', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'beads-create-parent-'));
    try {
      await execAsync('git init', { cwd: tempDir });
      await beads.init(tempDir);
      const epic = await beads.create(tempDir, 'Epic', { type: 'epic', priority: 2 });
      const child = await beads.create(tempDir, 'Child Task', {
        type: 'task',
        priority: 0,
        description: 'Do the thing',
        parentId: epic.id,
      });
      expect(child.id).toBeDefined();
      expect(child.title).toBe('Child Task');
      expect(child.description).toBe('Do the thing');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }, 10000);
});
