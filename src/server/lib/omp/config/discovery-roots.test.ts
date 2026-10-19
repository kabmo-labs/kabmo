/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The root table is data, and every consumer's correctness rests on it being
 * the set omp actually reads. These tests pin the two properties that have
 * already gone wrong once:
 *
 * - The SKILL set is not the COMMAND set. omp reads `.github/skills` for skills
 *   but `.github/prompts/*.prompt.md` for commands, and `~/.agents/skills` is
 *   skills-only while `~/.claude/commands`, `~/.codex/commands` and
 *   `~/.config/opencode/commands` are commands-only. A consumer that used one
 *   list for both would watch a root omp ignores, or miss one it reads.
 * - Only the omp-native roots are `managed`. Everything else belongs to another
 *   tool, so a save or delete through Kabmo must never reach it.
 */

import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  commandRoots,
  skillRoots,
  PROJECT_COMMAND_ROOTS,
} from '@/server/lib/omp/config/discovery-roots';

const PROJECT = '/tmp/some-workspace';

describe('skill roots', () => {
  test('covers every project root omp reads, not just the native one', () => {
    const dirs = skillRoots(PROJECT).map((root) => root.dir);
    for (const rel of ['.omp/skills', '.claude/skills', '.codex/skills', '.agents/skills', '.opencode/skills', '.github/skills']) {
      expect(dirs).toContain(join(PROJECT, rel));
    }
  });

  test('covers both user roots and nothing omp ignores', () => {
    const dirs = skillRoots().map((root) => root.dir);
    expect(dirs).toContain(join(homedir(), '.agents', 'skills'));
    // Verified NOT read at user level (omp 18.4.3): these exist for COMMANDS.
    expect(dirs.some((dir) => dir.includes(`${join('.claude', 'skills')}`))).toBe(false);
    expect(dirs.some((dir) => dir.includes(`${join('.codex', 'skills')}`))).toBe(false);
    expect(dirs.some((dir) => dir.includes(`${join('.config', 'opencode', 'skills')}`))).toBe(false);
  });

  test('marks only the omp-native roots managed', () => {
    const managed = skillRoots(PROJECT).filter((root) => root.managed).map((root) => root.dir);
    expect(managed.sort()).toEqual([join(PROJECT, '.omp/skills'), join(homedir(), '.omp/agent/skills')].sort());
  });

  test('a user-scope read has no project roots', () => {
    expect(skillRoots().every((root) => root.scope === 'user')).toBe(true);
    expect(skillRoots(PROJECT).some((root) => root.scope === 'project')).toBe(true);
  });

  test('includes the ancestor roots omp walks up to, but never manages them', async () => {
    // omp reads project skills from every ancestor up to the enclosing git repo,
    // so a skill in `<parent>/.omp/skills` is live for a session in a subdir.
    const outer = await mkdtemp(join(tmpdir(), 'omp-walkup-'));
    try {
      const inner = join(outer, 'inner');
      await mkdir(inner, { recursive: true });
      const dirs = skillRoots(inner).map((root) => root.dir);
      expect(dirs).toContain(join(inner, '.omp', 'skills'));
      expect(dirs).toContain(join(outer, '.omp', 'skills'));

      // The Kabmo's write/delete paths stay scoped to the cwd's own root: a
      // save in one project must not be able to rewrite a parent's files.
      const managed = skillRoots(inner).filter((root) => root.managed).map((root) => root.dir);
      expect(managed).not.toContain(join(outer, '.omp', 'skills'));
    } finally {
      await rm(outer, { recursive: true, force: true });
    }
  });

  test('the ancestor walk stops at a git repository boundary', async () => {
    const outer = await mkdtemp(join(tmpdir(), 'omp-walkup-'));
    try {
      const repo = join(outer, 'repo');
      const inner = join(repo, 'inner');
      await mkdir(inner, { recursive: true });
      // An empty `.git` is enough — omp treats the entry, dir or file, as the
      // repository root (verified on 18.4.3).
      await mkdir(join(repo, '.git'), { recursive: true });

      const dirs = skillRoots(inner).map((root) => root.dir);
      expect(dirs).toContain(join(repo, '.omp', 'skills'));
      // The walk stopped at the repo, so the directory ABOVE it is not read.
      expect(dirs).not.toContain(join(outer, '.omp', 'skills'));
    } finally {
      await rm(outer, { recursive: true, force: true });
    }
  });
});

describe('command roots', () => {
  test('uses the prompt-file layout for .github, not the skills one', () => {
    const github = commandRoots(PROJECT).find((root) => root.dir.includes('.github'));
    expect(github?.dir).toBe(join(PROJECT, '.github/prompts'));
    expect(github?.suffix).toBe('.prompt.md');
  });

  test('includes the user command roots omp reads but skills does not', () => {
    const dirs = commandRoots().map((root) => root.dir);
    for (const rel of ['.claude/commands', '.codex/commands', '.agents/commands', '.config/opencode/commands']) {
      expect(dirs).toContain(join(homedir(), rel));
    }
  });

  test('marks only the omp-native roots managed', () => {
    const managed = commandRoots(PROJECT).filter((root) => root.managed).map((root) => root.dir);
    expect(managed.sort()).toEqual([join(PROJECT, '.omp/commands'), join(homedir(), '.omp/agent/commands')].sort());
  });

  test('every project command root declares a suffix', () => {
    expect(PROJECT_COMMAND_ROOTS.every((entry) => entry.suffix.startsWith('.'))).toBe(true);
  });
});
