/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A workspace folder finds its sessions through a CANONICAL path, not through
 * the spelling the folder was registered under.
 *
 * `resolveRootsByCwd` runs every session's cwd through `resolveProjectRoot`,
 * which realpaths it, so the bucket key is canonical. A folder row holds the
 * spelling the user's path was registered with. On macOS those differ for
 * anything under `/var` (a symlink to `/private/var`), which is where every
 * temp directory lives — measured: a real-mode workspace in a temp directory
 * listed ZERO sessions, and the worktree badge could never appear because the
 * session was not even in the folder it belongs to.
 *
 * The symlink here is created by the test rather than borrowed from
 * `os.tmpdir()`, because on Linux the two spellings are identical and a
 * platform-shaped fixture would pass with the fix removed.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { isWindows, testPosix } from '@/test-support/platform';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getDb } from '@/server/db.server';
import { loadSidebarStructure } from '@/server/lib/omp/session/sidebar-data.server';
import { invalidateOmpSidebarData } from '@/server/lib/omp/session/reader';
import { clearSessionFileCaches } from '@/server/lib/omp/session/files';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { removeDir } from '@/test-support/remove-dir';

const saved = {
  agentDir: Bun.env.PI_CODING_AGENT_DIR,
  xdg: Bun.env.XDG_DATA_HOME,
  mock: Bun.env.MOCK,
  sync: Bun.env.SYNC_WORKSPACE,
};

/**
 * A budget, not a skip — the same one the git suites state for the same reason
 * (`git-actions-sync.test.ts`, `git-update.server.test.ts`).
 *
 * `loadSidebarStructure` is not a pure read here: a folder that HAS a session
 * reaches `sessionWorktreeMap`, which spawns `git worktree list` through
 * `listWorktrees`. Measured on `windows-latest` for commit `5bcd8870`, one run
 * of this file paid ~8.1s for the two cases whose folder has a session while the
 * SAME file on the SAME commit, in that commit's `CI` run, took 244ms and 270ms
 * — a runner outlier of ~30x, not a regression. The third case, whose folder has
 * no session and so spawns no git, passed at 1.2s inside the slow run.
 *
 * Without the budget the timeout is reported on one line and the late assertion
 * on the next as `received: []`, which reads as "the canonical bucket fix
 * regressed" — the opposite of what happened.
 */
setDefaultTimeout(30_000);

let root = '';
let sessionsRoot = '';
/** The directory a session actually ran in — what the scan resolves to. */
let realProject = '';
/** A symlink to it, which is how the folder is registered. */
let linkedProject = '';

beforeAll(async () => {
  root = await fs.promises.mkdtemp(join(tmpdir(), 'omc-sidebar-canonical-'));
  const agent = join(root, 'agent');
  sessionsRoot = join(agent, 'sessions');
  await fs.promises.mkdir(sessionsRoot, { recursive: true });

  realProject = join(root, 'real-project');
  await fs.promises.mkdir(realProject, { recursive: true });
  linkedProject = join(root, 'linked-project');
  if (!isWindows) await fs.promises.symlink(realProject, linkedProject, 'dir');

  Bun.env.PI_CODING_AGENT_DIR = agent;
  // XDG would redirect the sessions dir to $XDG_DATA_HOME/omp when it exists.
  delete Bun.env.XDG_DATA_HOME;
  Bun.env.MOCK = 'false';
  Bun.env.SYNC_WORKSPACE = 'false';
});

afterAll(() => {
  if (saved.agentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = saved.agentDir;
  if (saved.xdg === undefined) delete Bun.env.XDG_DATA_HOME;
  else Bun.env.XDG_DATA_HOME = saved.xdg;
  if (saved.mock === undefined) delete Bun.env.MOCK;
  else Bun.env.MOCK = saved.mock;
  if (saved.sync === undefined) delete Bun.env.SYNC_WORKSPACE;
  else Bun.env.SYNC_WORKSPACE = saved.sync;
  removeDir(root);
});

beforeEach(async () => {
  await isolateDb();
  // The sessions root is shared by the file, so each case starts from an empty
  // one: a file left by a previous case would be listed by the next, which is
  // what made the first run of this suite fail.
  await fs.promises.rm(join(sessionsRoot, 'project'), { recursive: true, force: true });
  invalidateOmpSidebarData();
  clearSessionFileCaches();
});

afterEach(async () => {
  await releaseDb();
});

/** One session file whose cwd is the CANONICAL spelling, as omp would record it. */
async function writeSession(id: string, cwd: string): Promise<void> {
  const dir = join(sessionsRoot, 'project');
  await fs.promises.mkdir(dir, { recursive: true });
  const lines = [
    JSON.stringify({ type: 'session', id, cwd, timestamp: '2026-10-23T00:00:00.000Z' }),
    JSON.stringify({
      type: 'message',
      id: `${id}-m1`,
      parentId: null,
      timestamp: '2026-10-23T00:00:01.000Z',
      message: { role: 'user', content: 'hello from the canonical bucket' },
    }),
  ];
  await Bun.write(join(dir, `${id}.jsonl`), `${lines.join('\n')}\n`);
}

/** A workspace folder row bound to `projectPath`. */
async function registerFolder(projectPath: string): Promise<number> {
  const db = await getDb();
  await db.run('INSERT INTO workspace_folders (name, project_path) VALUES (?, ?)', ['ws', projectPath]);
  const row = await db.get<{ id: number }>('SELECT id FROM workspace_folders ORDER BY id DESC LIMIT 1');
  return Number(row?.id);
}

describe('sidebar folders resolve sessions through a canonical path', () => {
  // The two cases below need the SYMLINK fixture, which is why they are
  // POSIX-only: `symlinkSync` wants a privilege a default Windows runner does
  // not have, and the one run that did create it resolved the canonical bucket
  // to nothing and reported the fixture's own limitation as this suite's
  // failure (`canonical-hit` expected, `[]` received, 36s). The claim itself is
  // a POSIX fact — macOS `/var` → `/private/var` is what put every temp-dir
  // workspace in a folder that listed zero sessions — so it is pinned where it
  // can be measured. The real-spelling case below stays portable, so the
  // Windows leg still covers the bucketing.
  testPosix('a folder registered under a symlinked spelling lists the sessions that ran in its target', async () => {
    // The session's cwd is the REAL directory; the folder names the symlink.
    // Without the canonical bucket key this is an empty folder.
    await writeSession('canonical-hit', realProject);
    await registerFolder(linkedProject);

    const payload = await loadSidebarStructure();
    const folder = payload.folders.find((entry) => entry.project_path === linkedProject);

    expect(folder).toBeDefined();
    expect(folder?.sessions.map((session) => session.id)).toEqual(['canonical-hit']);
  });

  test('a folder registered under the real spelling keeps listing its sessions', async () => {
    // The control: the fallback to the raw spelling must not be the only path
    // that works, or the fix would trade one empty folder for another.
    await writeSession('canonical-plain', realProject);
    await registerFolder(realProject);

    const payload = await loadSidebarStructure();
    const folder = payload.folders.find((entry) => entry.project_path === realProject);

    expect(folder?.sessions.map((session) => session.id)).toEqual(['canonical-plain']);
  });

  testPosix('a session in an unrelated directory stays out of the folder', async () => {
    const other = join(root, 'other-project');
    await fs.promises.mkdir(other, { recursive: true });
    await writeSession('canonical-elsewhere', other);
    await registerFolder(linkedProject);

    const payload = await loadSidebarStructure();
    const folder = payload.folders.find((entry) => entry.project_path === linkedProject);

    expect(folder?.sessions).toEqual([]);
  });
});
