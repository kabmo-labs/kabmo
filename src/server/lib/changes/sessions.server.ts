/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which sessions share a working directory.
 *
 * The scan layer is the one place a concurrent session can be misattributed: a
 * `git status` or a directory diff sees the other session's file too. Before a
 * scan records a path, it asks this module for the OTHER sessions in the same
 * cwd and skips a path one of them already recorded in the window.
 *
 * The cwd comes from each journal's `session` header, so the map is stable for
 * a session's lifetime. It is cached by the `changes/` root's path + mtime: a
 * new session directory changes the mtime, and a different data root changes
 * the path.
 */

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { changesRoot } from '@/server/lib/changes/paths.server';
import { parseJournalLine } from '@/server/lib/changes/records';
import { readRawHeaderLine } from '@kabmo-labs/kabmo-omp/session-scan/files';
import { findSessionFileById } from '@kabmo-labs/kabmo-omp/session-locator';

interface CwdCache {
  root: string;
  rootMtime: number;
  byCwd: Map<string, string[]>;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoSessionsByCwd: CwdCache | undefined;
}

/** The session's cwd: the Kabmo header first, then the omp transcript header. */
export async function sessionCwd(sessionId: string): Promise<string | null> {
  const file = path.join(changesRoot(), sessionId, 'changes.jsonl');
  const head = await Bun.file(file).slice(0, 1024).text().catch(() => '');
  const record = parseJournalLine(head.split('\n')[0] ?? '');
  if (record?.type === 'session') return record.cwd;

  const sessionFile = await findSessionFileById(sessionId);
  if (!sessionFile) return null;
  const header = await readRawHeaderLine(sessionFile).catch(() => null);
  return header && typeof header.cwd === 'string' ? header.cwd : null;
}

/** Session ids whose journal header names `cwd`, excluding `excludeSessionId`. */
export async function sessionsInCwd(cwd: string, excludeSessionId: string): Promise<string[]> {
  const root = changesRoot();
  const info = await stat(root).catch(() => null);
  if (!info) return [];

  let cache = globalThis.__kabmoSessionsByCwd;
  if (!cache || cache.root !== root || cache.rootMtime !== info.mtimeMs) {
    cache = { root, rootMtime: info.mtimeMs, byCwd: await buildByCwd(root) };
    globalThis.__kabmoSessionsByCwd = cache;
  }
  return (cache.byCwd.get(cwd) ?? []).filter((id) => id !== excludeSessionId);
}

async function buildByCwd(root: string): Promise<Map<string, string[]>> {
  const byCwd = new Map<string, string[]>();
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(root, entry.name, 'changes.jsonl');
    // The header is the first line; a slice keeps a 20 MB journal cheap to read.
    const head = await Bun.file(file).slice(0, 1024).text().catch(() => '');
    const record = parseJournalLine(head.split('\n')[0] ?? '');
    if (record?.type !== 'session') continue;
    const list = byCwd.get(record.cwd) ?? [];
    list.push(entry.name);
    byCwd.set(record.cwd, list);
  }
  return byCwd;
}
