/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Source Control panel's mutating actions, driven against a real
 * repository.
 *
 * Every case here is a bug the previous implementation had, and each was
 * reproduced by hand before it was fixed:
 *
 *  - a commit message is user text, and the route used to interpolate it into
 *    `git commit -m "<message>"` through `sh -c`, so a backtick or a `$( )` was
 *    EXECUTED (measured: ``fix `touch /tmp/PWN` thing`` created the file);
 *  - a filename is user text too, and one holding a double quote made `git add`
 *    exit 2 — which the revert path read as "untracked" and answered by
 *    deleting the file;
 *  - a folder holding a clean tracked file beside an untracked one had
 *    `git status --porcelain -- <dir>` open with `??`, so `revert` took an
 *    `rm -rf` branch and destroyed the committed file;
 *  - `revert` built its removal target with `path.join(targetDir, file)`, so a
 *    `../` path deleted a file OUTSIDE the working tree;
 *  - `git restore --staged` fails with "could not resolve 'HEAD'" in a
 *    repository whose first commit is still staged;
 *  - the commit modal's `checkout` sends a commit SHA, which the branch path
 *    answered with `fatal: '' is not a valid branch name` (the local-name
 *    derivation strips everything before the first `/`, and a SHA has none).
 */

import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { testPosix } from '@/test-support/platform';
import { action } from '@/server/routes/fs/git';
import { removeDir } from '@/test-support/remove-dir';

/**
 * Scratch fixtures, under a directory this file owns.
 *
 * It MUST be inside the app root: that is the route's own allow-list
 * (`resolveRoot` honors the app root, a path below it, or a registered
 * workspace). A repository in `/tmp` is not addressable through the route at
 * all — `resolveRoot` falls back to the app root's own working tree, so
 * `git add`/`git commit` ran against THE Kabmo REPOSITORY and committed the
 * developer's uncommitted work. Verified the hard way, twice.
 */
const FIXTURE_ROOT = path.join(process.cwd(), 'tmp-test-git-action');
const repos: string[] = [];

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync({ cmd: ['git', ...args], cwd });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString().trim();
}

/** A fresh repository, with one commit unless `commits` says otherwise. */
function makeRepo(commits = 1): string {
  fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
  const base = fs.mkdtempSync(path.join(FIXTURE_ROOT, 'repo-'));
  const dir = path.join(base, 'work');
  fs.mkdirSync(dir);
  repos.push(base);
  git(dir, 'init', '-q', '-b', 'main');
  // Pin the line ending: a Windows host defaults `core.autocrlf` to true, which
  // rewrites every checked-out file to CRLF.
  git(dir, 'config', 'core.autocrlf', 'false');
  git(dir, 'config', 'core.eol', 'lf');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'Test');
  if (commits > 0) {
    fs.writeFileSync(path.join(dir, 'base.txt'), 'base\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'base');
  }
  return dir;
}

/**
 * The guard that keeps this file from repeating its own history.
 *
 * `resolveRoot` silently substitutes the app root for a root it cannot honor,
 * and every fixture here is driven through that route — so a fixture that is
 * not where this file thinks it is would commit to Kabmo repository
 * instead. Asserting the resolved directory is the fixture, on every call, is
 * what turns that silent substitution into a failed test.
 */
function assertFixture(dir: string): void {
  if (!dir.startsWith(FIXTURE_ROOT + path.sep)) {
    throw new Error(`refusing to run a git action outside the fixture root: ${dir}`);
  }
}

/** POST one action; the route reads its operands from the form body. */
async function post(fields: Record<string, string>): Promise<{ status: number; body: { success?: boolean; error?: string } }> {
  assertFixture(fields.root ?? '');
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const response = await action({
    request: new Request('http://localhost/api/fs/git', { method: 'POST', body: form }),
  } as never);
  return { status: response.status, body: (await response.json()) as { success?: boolean; error?: string } };
}

function porcelain(cwd: string): string {
  const result = Bun.spawnSync({ cmd: ['git', 'status', '--porcelain=v1', '-uall'], cwd });
  return result.stdout.toString().trim();
}

afterAll(() => {
  for (const dir of repos) removeDir(dir);
  // The whole scratch root goes, not just the repos this run made: a previous
  // crashed run would otherwise leave fixtures inside the working tree.
  removeDir(FIXTURE_ROOT);
});

describe('git action operands are argv, never shell text', () => {
  test('a commit message holding a command substitution is committed verbatim', async () => {
    const repo = makeRepo();
    const marker = path.join(repo, 'INJECTED');
    fs.writeFileSync(path.join(repo, 'base.txt'), 'changed\n');
    await post({ actionType: 'stage_all', repo: '.', root: repo });

    const message = `fix $(touch ${marker}) thing`;
    const res = await post({ actionType: 'commit', repo: '.', root: repo, message });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // The substitution must NOT have run, and the message must be intact.
    expect(fs.existsSync(marker)).toBe(false);
    const subject = Bun.spawnSync({ cmd: ['git', 'log', '-1', '--pretty=%s'], cwd: repo }).stdout.toString().trim();
    expect(subject).toBe(message);
  });

  // `"` is not a legal Windows filename character (`writeFileSync` answers ENOENT),
  // so a git fixture holding one can only exist on POSIX.
  testPosix('a filename holding a double quote can be staged and unstaged', async () => {
    const repo = makeRepo();
    const name = 'a"b.txt';
    fs.writeFileSync(path.join(repo, name), 'x\n');

    const staged = await post({ actionType: 'stage', repo: '.', root: repo, file: name });
    expect(staged.body.success).toBe(true);
    expect(porcelain(repo)).toContain('A  "a\\"b.txt"');

    const unstaged = await post({ actionType: 'unstage', repo: '.', root: repo, file: name });
    expect(unstaged.body.success).toBe(true);
    expect(porcelain(repo)).toContain('?? "a\\"b.txt"');
    expect(fs.existsSync(path.join(repo, name))).toBe(true);
  });
});

describe('discard', () => {
  test('a folder holding a clean tracked file beside an untracked one keeps the tracked file', async () => {
    const repo = makeRepo();
    fs.mkdirSync(path.join(repo, 'dir'));
    fs.writeFileSync(path.join(repo, 'dir', 'keep.txt'), 'important\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'add dir');
    fs.writeFileSync(path.join(repo, 'dir', 'new.txt'), 'untracked\n');

    const res = await post({ actionType: 'revert', repo: '.', root: repo, file: 'dir' });

    expect(res.body.success).toBe(true);
    expect(fs.readFileSync(path.join(repo, 'dir', 'keep.txt'), 'utf8')).toBe('important\n');
    expect(fs.existsSync(path.join(repo, 'dir', 'new.txt'))).toBe(false);
  });

  test('a modified tracked file is restored, not deleted', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'base.txt'), 'base\nmodified\n');

    const res = await post({ actionType: 'revert', repo: '.', root: repo, file: 'base.txt' });

    expect(res.body.success).toBe(true);
    expect(fs.readFileSync(path.join(repo, 'base.txt'), 'utf8')).toBe('base\n');
    expect(porcelain(repo)).toBe('');
  });

  test('a path escaping the working tree is refused and touches nothing', async () => {
    const repo = makeRepo();
    const outside = path.join(repo, '..', `victim-${path.basename(repo)}.txt`);
    fs.writeFileSync(outside, 'precious\n');
    try {
      const res = await post({ actionType: 'revert', repo: '.', root: repo, file: '../' + path.basename(outside) });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid path');
      expect(fs.readFileSync(outside, 'utf8')).toBe('precious\n');
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  test('an untracked file is removed', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'new.txt'), 'x\n');

    const res = await post({ actionType: 'revert', repo: '.', root: repo, file: 'new.txt' });

    expect(res.body.success).toBe(true);
    expect(fs.existsSync(path.join(repo, 'new.txt'))).toBe(false);
  });
});

describe('a repository whose first commit is still staged', () => {
  test('unstage works before HEAD exists', async () => {
    const repo = makeRepo(0);
    fs.writeFileSync(path.join(repo, 'first.txt'), 'a\n');
    await post({ actionType: 'stage_all', repo: '.', root: repo });
    expect(porcelain(repo)).toContain('A  first.txt');

    const res = await post({ actionType: 'unstage', repo: '.', root: repo, file: 'first.txt' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(porcelain(repo)).toContain('?? first.txt');
  });

  test('unstage_all works before HEAD exists', async () => {
    const repo = makeRepo(0);
    fs.writeFileSync(path.join(repo, 'first.txt'), 'a\n');
    await post({ actionType: 'stage_all', repo: '.', root: repo });

    const res = await post({ actionType: 'unstage_all', repo: '.', root: repo });

    expect(res.body.success).toBe(true);
    expect(porcelain(repo)).toContain('?? first.txt');
  });

  test('a staged add is discarded, not just unstaged', async () => {
    const repo = makeRepo(0);
    fs.writeFileSync(path.join(repo, 'first.txt'), 'a\n');
    await post({ actionType: 'stage_all', repo: '.', root: repo });

    const res = await post({ actionType: 'revert', repo: '.', root: repo, file: 'first.txt' });

    expect(res.body.success).toBe(true);
    expect(porcelain(repo)).toBe('');
    expect(fs.existsSync(path.join(repo, 'first.txt'))).toBe(false);
  });
});

describe('checkout from a commit row', () => {
  test('a commit SHA detaches instead of failing as a branch name', async () => {
    const repo = makeRepo();
    const sha = Bun.spawnSync({ cmd: ['git', 'rev-parse', 'HEAD'], cwd: repo }).stdout.toString().trim();

    const res = await post({ actionType: 'checkout', repo: '.', root: repo, branch: sha });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const head = Bun.spawnSync({ cmd: ['git', 'rev-parse', 'HEAD'], cwd: repo }).stdout.toString().trim();
    expect(head).toBe(sha);
  });

  test('a remote branch still creates and tracks a local one', async () => {
    const repo = makeRepo();
    const origin = makeRepo(0);
    git(origin, 'config', 'core.bare', 'true');
    fs.rmSync(path.join(origin, 'base.txt'), { force: true });
    git(repo, 'remote', 'add', 'origin', origin);
    git(repo, 'push', '-q', '-u', 'origin', 'main');
    git(repo, 'checkout', '-q', '-b', 'feature');
    git(repo, 'push', '-q', 'origin', 'feature');
    git(repo, 'checkout', '-q', 'main');
    git(repo, 'branch', '-q', '-D', 'feature');

    const res = await post({ actionType: 'checkout', repo: '.', root: repo, branch: 'origin/feature' });

    expect(res.body.success).toBe(true);
    const branch = Bun.spawnSync({ cmd: ['git', 'rev-parse', '--abbrev-ref', 'HEAD'], cwd: repo }).stdout.toString().trim();
    expect(branch).toBe('feature');
  });
});

describe('create_branch', () => {
  test('the toolbar action creates the branch AND switches to it', async () => {
    const repo = makeRepo();
    const head = git(repo, 'rev-parse', 'HEAD');

    const res = await post({ actionType: 'create_branch', repo: '.', root: repo, branch: 'switched' });

    expect(res.body.success).toBe(true);
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('switched');
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(head);
  });
});

describe('create_branch_at (the commit row\'s "create branch here")', () => {
  test('starts at the commit it was given, not at HEAD', async () => {
    const repo = makeRepo();
    const first = git(repo, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(repo, 'second.txt'), 'b\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'second');

    const res = await post({ actionType: 'create_branch_at', repo: '.', root: repo, branch: 'from-first', hash: first });

    expect(res.body.success).toBe(true);
    expect(git(repo, 'rev-parse', 'from-first')).toBe(first);
  });

  test('leaves the working tree where it was, so a dirty repo still works', async () => {
    const repo = makeRepo();
    const first = git(repo, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(repo, 'second.txt'), 'b\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'second');
    // Dirty: `git checkout -b <name> <sha>` refuses with "Your local changes …
    // would be overwritten by checkout", which is what the button used to do.
    fs.writeFileSync(path.join(repo, 'second.txt'), 'b\ndirty\n');

    const res = await post({ actionType: 'create_branch_at', repo: '.', root: repo, branch: 'from-dirty', hash: first });

    expect(res.body.success).toBe(true);
    expect(git(repo, 'rev-parse', 'from-dirty')).toBe(first);
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(fs.readFileSync(path.join(repo, 'second.txt'), 'utf8')).toBe('b\ndirty\n');
  });

  test('with no start point it branches from HEAD', async () => {
    const repo = makeRepo();
    const head = git(repo, 'rev-parse', 'HEAD');

    const res = await post({ actionType: 'create_branch_at', repo: '.', root: repo, branch: 'plain' });

    expect(res.body.success).toBe(true);
    expect(git(repo, 'rev-parse', 'plain')).toBe(head);
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
  });
});

/* `init` has its own file (`git-init-action.test.ts`): its fixtures are a
   directory that is NOT a repository, and the two files together exceeded the
   repo's line ceiling. */
