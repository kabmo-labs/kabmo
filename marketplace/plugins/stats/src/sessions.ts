/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The title of a session, and the file it lives in.
 *
 * omp writes a session's name as the FIRST line of its JSONL:
 *
 * ```json
 * {"type":"title","v":1,"title":"󰆊 OMP: Compare oh-my-pi features with omp","source":"user","updatedAt":"…","pad":"   "}
 * ```
 *
 * It is a fixed-size slot — the line is padded so omp can rewrite a rename in
 * place without shifting the file — which is why the read is bounded: the whole
 * record is 256 bytes, and reading the first kilobyte of a multi-megabyte
 * transcript costs nothing (measured: 0.65 ms for one file).
 *
 * ## Paths, resolved here rather than imported
 *
 * A panel plugin is bundled into the host, and only `@kabmo-labs/*` specifiers
 * are shared — Kabmo's own `@/server/lib/omp/core/paths` is not reachable
 * from a plugin. So the three rules that decide where omp keeps agent state are
 * restated here: `PI_CODING_AGENT_DIR` overrides the agent dir, `PI_CONFIG_DIR`
 * renames the config root, and the XDG data layout is used only once
 * `$XDG_DATA_HOME/omp` EXISTS (omp makes it opt-in via `omp config init-xdg`).
 * Getting the last one wrong reports an empty title for every session on an XDG
 * install, which reads as "the file is gone" rather than "looked in the wrong
 * place".
 *
 * ## The cache is keyed by mtime
 *
 * omp rewrites the title slot IN PLACE, so a rename keeps the file's size and
 * changes only its mtime. Keying the cache on the path alone would pin the
 * first title forever; keying it on (mtime, size) re-reads exactly when the
 * file moved.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP_NAME = 'omp';
const CONFIG_DIR_NAME = '.omp';

/** Bytes read from the head of a session file. The title slot is 256. */
const TITLE_READ_BYTES = 1024;

/** Config root (~/.omp, honouring the `PI_CONFIG_DIR` rename). */
function configRoot(): string {
  return path.join(os.homedir(), Bun.env.PI_CONFIG_DIR || CONFIG_DIR_NAME);
}

/** The agent state dir, honouring `PI_CODING_AGENT_DIR`. */
function agentDir(): string {
  const override = Bun.env.PI_CODING_AGENT_DIR;
  if (override) return path.resolve(override);
  return path.join(configRoot(), 'agent');
}

/** True while nothing overrides the agent dir, which is the XDG precondition. */
function isDefaultAgentDir(): boolean {
  const override = Bun.env.PI_CODING_AGENT_DIR;
  if (override) return path.resolve(override) === path.join(configRoot(), 'agent');
  return true;
}

/** `$XDG_DATA_HOME/omp` when the layout is in use, else undefined. */
function xdgAppRoot(): string | undefined {
  if (process.platform !== 'linux' && process.platform !== 'darwin') return undefined;
  if (!isDefaultAgentDir()) return undefined;
  const value = Bun.env.XDG_DATA_HOME;
  if (!value) return undefined;
  try {
    const appRoot = path.join(value, APP_NAME);
    return fs.existsSync(appRoot) ? appRoot : undefined;
  } catch {
    return undefined;
  }
}

/** `<sessions>` — `~/.omp/agent/sessions` or `$XDG_DATA_HOME/omp/sessions`. */
export function sessionsDir(): string {
  return path.join(xdgAppRoot() ?? agentDir(), 'sessions');
}

/**
 * `<configRoot>/run/session-owners` — where omp keeps its per-session leases.
 *
 * Deliberately the CONFIG root and not the XDG data root: the lease is process
 * state, and `lease-holder.server.ts` in Kabmo reads it from the same
 * place. A host that relocated only its DATA would still hold leases here.
 */
export function leasesDir(): string {
  return path.join(configRoot(), 'run', 'session-owners');
}

/** The session file for an id, or null when no transcript exists yet. */
export function sessionFileForId(id: string): string | null {
  const root = sessionsDir();
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  // The id is a SUFFIX of `<timestamp>_<id>.jsonl`, never the whole name.
  const suffix = `_${id}.jsonl`;
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(root, dir.name);
    try {
      const hit = fs.readdirSync(dirPath).find((name) => name.endsWith(suffix));
      if (hit) return path.join(dirPath, hit);
    } catch {
      // A directory that vanished between the two reads.
    }
  }
  return null;
}

/** The id inside a `--resume <path>` operand, or null. */
export function sessionIdFromPath(file: string): string | null {
  return /_([0-9a-f-]{36})\.jsonl$/.exec(file)?.[1] ?? null;
}

interface CachedTitle {
  mtimeMs: number;
  size: number;
  title: string | null;
}

const titleCache = new Map<string, CachedTitle>();

/**
 * The title omp stored for a session file, or null.
 *
 * Null covers two states the caller renders the same way and should not
 * conflate: the file has no title slot yet (a session whose first message omp's
 * low-signal filter rejected, so it was never named), and the file cannot be
 * read at all. The caller falls back to the short session id for both.
 */
export function titleForSessionFile(file: string): string | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  const cached = titleCache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.title;

  let title: string | null = null;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(TITLE_READ_BYTES);
      const read = fs.readSync(fd, buffer, 0, TITLE_READ_BYTES, 0);
      const firstLine = buffer.subarray(0, read).toString('utf8').split('\n')[0];
      const record = JSON.parse(firstLine) as { type?: unknown; title?: unknown };
      if (record?.type === 'title' && typeof record.title === 'string' && record.title.trim()) {
        title = record.title.trim();
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Truncated mid-write, or not ours to read.
    title = null;
  }
  titleCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, title });
  return title;
}

/** When the session file was last written, or null. */
export function lastWriteMs(file: string): number | null {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

/** The title for a session ID, resolved through its file. Null when unnamed. */
export function titleForSessionId(id: string): string | null {
  const file = sessionFileForId(id);
  return file ? titleForSessionFile(file) : null;
}
