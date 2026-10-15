/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A git repository a spec can clone FROM.
 *
 * `POST /api/folders/clone` shells out to the real `git`, so a spec that stubs
 * the clone would test the stub rather than the argv the route builds. This
 * makes a real origin instead: `git init` plus one commit, in a temp directory
 * whose path doubles as the clone URL (a local path is one of the forms
 * `isGitUrl` accepts, and `git clone` treats it as first-class).
 *
 * The commit is made through `git -c` rather than by writing a `.gitconfig`,
 * so the fixture cannot depend on — or disturb — a developer's own git
 * identity.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface SeedRepo {
  /** The directory to hand `git clone` — a local path, not a `file://` URL. */
  url: string;
  /** The last path segment, which is the slug the route clones into. */
  slug: string;
  dispose(): void;
}

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

/** Create a fresh repository with one commit and return its path as a URL. */
export function seedRepo(name: string): SeedRepo {
  const dir = mkdtempSync(join(tmpdir(), `omc-e2e-${name}-`));
  git(['init', '-q', '-b', 'main'], dir);
  writeFileSync(join(dir, 'README.md'), `# ${name}\n`);
  git(['add', '-A'], dir);
  git(
    ['-c', 'user.email=e2e@example.invalid', '-c', 'user.name=E2E', 'commit', '-q', '-m', 'seed'],
    dir,
  );
  return {
    url: dir,
    slug: dir.split('/').pop() ?? name,
    dispose() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A directory to clone INTO, removed on dispose. */
export function seedCloneParent(name: string): { path: string; dispose(): void } {
  const dir = mkdtempSync(join(tmpdir(), `omc-e2e-${name}-`));
  return {
    path: dir,
    dispose() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export interface SeedWorkingRepo {
  /** The repository's own directory — what a workspace folder is bound to. */
  path: string;
  /** Run a git command in it (fixtures set up state the spec then drives). */
  git(...args: string[]): string;
  /**
   * Run a git command that is EXPECTED to exit non-zero.
   *
   * A fixture routinely drives commands that fail by design — a conflicting
   * merge, a rebase, a `stash pop` — and those exit 1 with the state left
   * behind, which is the whole point. `execFileSync` throws on a non-zero exit,
   * so a fixture using `git()` for them would fail before the spec ever ran.
   */
  gitAllowFail(...args: string[]): string;
  dispose(): void;
}

/** A scratch working repository, with an identity that cannot leak. */
export function seedWorkingRepo(name: string): SeedWorkingRepo {
  const dir = mkdtempSync(join(tmpdir(), `omc-e2e-${name}-`));
  const env = { ...process.env, GIT_EDITOR: 'true' };
  const identity = ['-c', 'user.email=e2e@example.invalid', '-c', 'user.name=E2E'];
  const repo: SeedWorkingRepo = {
    path: dir,
    git: (...args: string[]): string =>
      execFileSync('git', [...identity, ...args], { cwd: dir, stdio: 'pipe', env }).toString(),
    gitAllowFail: (...args: string[]): string => {
      try {
        return execFileSync('git', [...identity, ...args], { cwd: dir, stdio: 'pipe', env }).toString();
      } catch (error) {
        // The stdout/stderr a failing git wrote is what a caller inspects; the
        // exit code is the expected part.
        const failed = error as { stdout?: Buffer; stderr?: Buffer };
        return `${failed.stdout?.toString() ?? ''}${failed.stderr?.toString() ?? ''}`;
      }
    },
    dispose() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
  repo.git('init', '-q', '-b', 'main');
  // The identity goes into the repository's OWN config, not only the `-c` flags
  // `git()` passes per command. The code under test runs git through a separate
  // process that inherits none of those flags, and git needs an identity for
  // operations the fixture then drives through the API — a merge that stops on a
  // conflict, a rebase, a stash pop — so on a runner with no global git identity
  // those failed with "Committer identity unknown". A developer's machine has a
  // global identity, which is why the suite passed locally and failed in CI.
  repo.git('config', 'user.email', 'e2e@example.invalid');
  repo.git('config', 'user.name', 'E2E');
  return repo;
}

/**
 * A scratch working repository at a CHOSEN path, with an identity that cannot leak.
 *
 * `seedWorkingRepo` mints its own temp directory, which is right when the repo
 * IS the workspace. This one seeds INTO a directory that already exists — the
 * shape the repository modal exists for: a workspace folder that is a parent of
 * several repositories rather than a repository itself.
 *
 * The directory is created if missing and REMOVED on dispose, so a caller that
 * hands over a child of its own temp root still cleans up after itself.
 */
export function seedWorkingRepoIn(dir: string, name: string): SeedWorkingRepo {
  mkdirSync(dir, { recursive: true });
  const env = { ...process.env, GIT_EDITOR: 'true' };
  const identity = ['-c', 'user.email=e2e@example.invalid', '-c', 'user.name=E2E'];
  const repo: SeedWorkingRepo = {
    path: dir,
    git: (...args: string[]): string =>
      execFileSync('git', [...identity, ...args], { cwd: dir, stdio: 'pipe', env }).toString(),
    gitAllowFail: (...args: string[]): string => {
      try {
        return execFileSync('git', [...identity, ...args], { cwd: dir, stdio: 'pipe', env }).toString();
      } catch (error) {
        const failed = error as { stdout?: Buffer; stderr?: Buffer };
        return `${failed.stdout?.toString() ?? ''}${failed.stderr?.toString() ?? ''}`;
      }
    },
    dispose() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
  repo.git('init', '-q', '-b', 'main');
  repo.git('config', 'user.email', 'e2e@example.invalid');
  repo.git('config', 'user.name', 'E2E');
  writeFileSync(join(dir, 'f.txt'), 'base\n');
  repo.git('add', '-A');
  repo.git('commit', '-q', '-m', `${name} base`);
  return repo;
}

/**
 * Two branches that edit the same line, so a merge stops on a conflict.
 *
 * The shape the conflict surfaces need: `UU` in the status, markers on disk,
 * and a real `MERGE_HEAD` for the operation bar to find.
 */
export function seedConflictingBranches(repo: SeedWorkingRepo, file = 'shared.txt'): void {
  writeFileSync(join(repo.path, file), 'line one\nline two\nline three\n');
  repo.git('add', '-A');
  repo.git('commit', '-q', '-m', 'base commit');
  repo.git('checkout', '-q', '-b', 'feature');
  writeFileSync(join(repo.path, file), 'line one\nFEATURE\nline three\n');
  repo.git('commit', '-q', '-am', 'feature change');
  repo.git('checkout', '-q', 'main');
  writeFileSync(join(repo.path, file), 'line one\nMAIN\nline three\n');
  repo.git('commit', '-q', '-am', 'main change');
}

