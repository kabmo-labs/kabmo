/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Repository identity, and the settings-driven location rule.
 *
 * Identity has one property that is easy to get wrong and expensive when it is:
 * the derivation (`rev-list --max-parents=0 --all`, sorted, first) is NOT stable.
 * Measured: a repository that gains a branch with unrelated history inserts a
 * second root and the sorted-first value MOVES, so a repository would start
 * looking for its worktrees in a different folder. That is why a stored value
 * always wins — the behavior this file pins.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalPath } from '@/server/lib/fs/canonical';
import { deriveProjectId, resolveProjectId } from '@/server/lib/fs/worktree/project-id';
import {
  defaultWorktreeRoot,
  generateAvailableName,
  resolveConfiguredWorktreeRoot,
  resolveTargetDirectory,
  worktreeNameCandidates,
} from '@/server/lib/fs/worktree/location';
import { removeDir } from '@/test-support/remove-dir';

const FIXTURE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-worktree-location-'));

const GIT_ENV_FOR_TESTS = {
  ...Bun.env,
  GIT_EDITOR: 'true',
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
};

function git(cwd: string, ...args: string[]): string {
  return Bun.spawnSync({ cmd: ['git', ...args], cwd, env: GIT_ENV_FOR_TESTS }).stdout.toString();
}

function makeRepo(name: string): string {
  const dir = path.join(FIXTURE_ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main', '.');
  fs.writeFileSync(path.join(dir, 'f.txt'), 'a\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

afterAll(() => {
  removeDir(FIXTURE_ROOT);
});

describe('deriveProjectId', () => {
  test('two clones of one repository share the identity', async () => {
    const bare = path.join(FIXTURE_ROOT, 'origin.git');
    fs.mkdirSync(bare, { recursive: true });
    git(bare, 'init', '-q', '--bare');

    const first = makeRepo('clone-a');
    git(first, 'remote', 'add', 'origin', bare);
    const head = git(first, 'rev-parse', 'HEAD').trim();
    git(first, 'push', '-q', 'origin', `${head}:refs/heads/main`);

    const second = path.join(FIXTURE_ROOT, 'clone-b');
    git(FIXTURE_ROOT, 'clone', '-q', bare, second);

    const a = await deriveProjectId(first);
    const b = await deriveProjectId(second);
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  test('an unborn repository has no identity — the `no_commits` refusal', async () => {
    const empty = path.join(FIXTURE_ROOT, 'unborn');
    fs.mkdirSync(empty, { recursive: true });
    git(empty, 'init', '-q', '-b', 'main', '.');
    expect(await deriveProjectId(empty)).toBeNull();
  });

  test('a stored identity wins over a re-derivation', async () => {
    const repo = makeRepo('identity-stored');
    const stored = 'stored-project-id';
    const identityFor = async () => stored;
    expect(await resolveProjectId(await canonicalPath(repo), identityFor)).toBe(stored);
  });

  test('an added orphan branch changes the derivation — hence the cache', async () => {
    const repo = makeRepo('identity-orphan');
    const derived = await deriveProjectId(repo);
    expect(derived).not.toBeNull();

    git(repo, 'checkout', '-q', '--orphan', 'other');
    git(repo, 'rm', '-rq', '--cached', '.');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'other root');

    // Two roots now exist, so the sorted-first value is a different question
    // than it was — which is exactly why the stored value is consulted first.
    const roots = git(repo, 'rev-list', '--max-parents=0', '--all')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    expect(roots.length).toBe(2);

    // The stored value is consulted first, whatever the derivation now answers.
    const stored = derived as string;
    const later = await resolveProjectId(await canonicalPath(repo), async () => stored);
    expect(later).toBe(stored);
  });
});

describe('worktree location', () => {
  // A literal POSIX spelling is not portable: `path.resolve('/repo', '.worktrees')`
  // answers `D:\repo\.worktrees` on a Windows runner, which is the CORRECT
  // answer for that platform and not a product bug. Every expectation is
  // therefore built through `path`, so the rule is asserted rather than the
  // separator.
  const checkout = path.resolve('/repo');
  const home = path.resolve('/home/u');

  test('three spellings, and the resolved value is always the parent', () => {
    expect(resolveConfiguredWorktreeRoot('', checkout)).toBeNull();
    expect(resolveConfiguredWorktreeRoot(null, checkout)).toBeNull();
    expect(resolveConfiguredWorktreeRoot('   ', checkout)).toBeNull();
    expect(resolveConfiguredWorktreeRoot('../wt', checkout)).toBe(path.resolve(checkout, '..', 'wt'));
    expect(resolveConfiguredWorktreeRoot('.worktrees', checkout)).toBe(path.join(checkout, '.worktrees'));
    expect(resolveConfiguredWorktreeRoot('/abs/wt', checkout)).toBe(path.resolve(checkout, '/abs/wt'));
    expect(resolveConfiguredWorktreeRoot('~/wt', checkout, home)).toBe(path.join(home, 'wt'));
    expect(resolveConfiguredWorktreeRoot('~', checkout, home)).toBe(home);
  });

  test('the default root is keyed per repository, outside every checkout', () => {
    expect(defaultWorktreeRoot('/data', 'abc123')).toBe(path.join('/data', 'worktrees', 'abc123'));
  });

  test('the slug is tried first, then slug-word-word', () => {
    const candidates = worktreeNameCandidates('quick-otter');
    expect(candidates[0]).toBe('quick-otter');
    expect(candidates[1]).toMatch(/^quick-otter-[a-z]+-[a-z]+$/);
    expect(candidates.length).toBe(26);
  });

  test('a taken folder moves to the next candidate rather than refusing', async () => {
    const root = path.join(FIXTURE_ROOT, 'collide');
    fs.mkdirSync(path.join(root, 'quick-otter'), { recursive: true });

    const target = await resolveTargetDirectory({
      root,
      preferredName: 'quick-otter',
      generatedBranch: (name) => `wt/${name}`,
      branchExists: async () => false,
    });
    expect(target.directory).not.toBe(path.join(root, 'quick-otter'));
    expect(target.name.startsWith('quick-otter-')).toBe(true);
  });

  test('a taken BRANCH is skipped too, so folder and branch never disagree', async () => {
    const root = path.join(FIXTURE_ROOT, 'branch-collide');
    fs.mkdirSync(root, { recursive: true });

    const target = await resolveTargetDirectory({
      root,
      preferredName: 'quick-otter',
      generatedBranch: (name) => `wt/${name}`,
      branchExists: async (branch) => branch === 'wt/quick-otter',
    });
    expect(target.branch).not.toBe('wt/quick-otter');
    expect(target.branch).toBe(`wt/${target.name}`);
  });

  test('a typed branch is used verbatim in both modes', async () => {
    const root = path.join(FIXTURE_ROOT, 'verbatim');
    fs.mkdirSync(root, { recursive: true });
    const target = await resolveTargetDirectory({
      root,
      preferredName: 'payments',
      explicitBranch: 'feat/payments',
      generatedBranch: (name) => `wt/${name}`,
      // Even when every generated name is taken, the typed branch is used.
      branchExists: async () => true,
    });
    expect(target.branch).toBe('feat/payments');
    expect(target.name).toBe('payments');
  });

  test('a generated name avoids both a folder and a branch', async () => {
    const root = path.join(FIXTURE_ROOT, 'generated');
    fs.mkdirSync(root, { recursive: true });
    const name = await generateAvailableName({
      root,
      branchExists: async (branch) => branch === 'wt/blocked',
      attempts: 4,
    });
    expect(name).not.toBe('blocked');
    expect(name).toMatch(/^[a-z]+-[a-z]+$/);
  });
});
