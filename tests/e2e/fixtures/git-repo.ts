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
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
