/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What a plugin directory's own `.git` says about where it came from.
 *
 * A plugin installed from a git URL is a CLONE, and that clone is the only
 * record of its origin: the marketplace catalog names a relative path
 * (`plugins/<id>`), never the URL. So the origin is read off the directory
 * rather than stored beside the catalog entry — a second copy the user could
 * edit into disagreement with the clone would be a second answer to the same
 * question.
 *
 * **No `git` spawn.** This runs inside the panel scan, which every `/api/panels`
 * request reaches, so a process per plugin per scan is the one cost that cannot
 * be paid. Reading `.git/config` and picking out one key is a file read; the
 * spawns live in `git-update.server.ts`, on the path a user or the auto-update
 * pass actually triggers.
 *
 * The two shapes a clone takes on disk are both handled, because a user can turn
 * one into the other: a normal clone holds `.git` as a DIRECTORY, while a linked
 * worktree holds `.git` as a FILE containing `gitdir: <path>`, and its config
 * then lives in the main repository's git directory named by `commondir`.
 */

import { stat } from 'fs/promises';
import { join, resolve } from 'path';

async function statOrNull(path: string): Promise<{ isDirectory(): boolean } | null> {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

/** Read a text file, or null when it cannot be read. */
async function readTextOrNull(path: string): Promise<string | null> {
  try {
    return await Bun.file(path).text();
  } catch {
    return null;
  }
}

/**
 * The directory holding a clone's git data, or null when this is not a clone.
 *
 * A worktree's `.git` file points at `<main>/.git/worktrees/<name>`, whose own
 * `commondir` file (`../..`) names the main git directory — and it is THAT one
 * that holds `config`. Resolving it is what keeps a worktree-ified plugin from
 * reporting "no origin".
 */
async function resolveGitDir(pluginDir: string): Promise<string | null> {
  const dotGit = join(pluginDir, '.git');
  const info = await statOrNull(dotGit);
  if (!info) return null;
  if (info.isDirectory()) return dotGit;

  const text = (await readTextOrNull(dotGit)) ?? '';
  const target = /^gitdir:\s*(.+)$/m.exec(text)?.[1]?.trim();
  if (!target) return null;
  const gitDir = resolve(pluginDir, target);
  if (!(await statOrNull(gitDir))) return null;

  const common = (await readTextOrNull(join(gitDir, 'commondir')))?.trim();
  if (!common) return gitDir;
  const resolved = resolve(gitDir, common);
  return (await statOrNull(resolved)) ? resolved : gitDir;
}

/**
 * The `url` of the clone's `origin` remote, or null when there is none.
 *
 * Deliberately a hand parse of the one key rather than a `git config` spawn —
 * see the module note. Only the `[remote "origin"]` section is consulted, and a
 * bare `url =` under any other section (a `[submodule …]` block holds one) is
 * ignored: a clone with no origin is a clone the updater must refuse rather than
 * guess a remote for.
 *
 * Split on `\r?\n`, not `\n`: git writes the config with the platform's line
 * ending, so on Windows every line arrives with a trailing `\r` and
 * `[remote "origin"]\r` does not match the anchored section regex. Measured on
 * the first Windows run: every clone read as "no origin", so a git-installed
 * plugin reported no update and `probeGitUpdate` claimed its directory was gone.
 */
function originUrlFromConfig(text: string): string | null {
  let inOrigin = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      inOrigin = /^\[remote\s+"origin"\]$/.test(line);
      continue;
    }
    if (!inOrigin) continue;
    const url = /^url\s*=\s*(.*)$/.exec(line);
    if (url) return url[1].trim() || null;
  }
  return null;
}

/** The clone's origin URL, or null when the directory is not a clone with one. */
export async function readGitOrigin(pluginDir: string): Promise<string | null> {
  const gitDir = await resolveGitDir(pluginDir);
  if (!gitDir) return null;
  const config = await readTextOrNull(join(gitDir, 'config'));
  return config ? originUrlFromConfig(config) : null;
}
