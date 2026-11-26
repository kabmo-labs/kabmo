/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * OpenCode's local database: `$XDG_DATA_HOME/opencode/opencode.db`.
 *
 * Two schema generations exist in the wild. `message` (v1) stores the assistant
 * row's `tokens`/`cost` inline; `session_message` (v2) stores the same counters
 * in `data`. A session is read from ONE of them — a migrated install can hold
 * rows in both, and folding both would count the same turn twice. v2 wins for a
 * session that has any v2 message.
 *
 * OpenCode reports its own cost, so a row with tokens and no cost is genuinely
 * unpriced rather than missing a parser.
 */

import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import { join } from 'node:path';

import type { HarnessId } from '@kabmo-labs/kabmo-harness/catalog';
import { isRecord } from '@kabmo-labs/kabmo-guards';
import type { UsageRollupRow } from '@/server/lib/usage/index-parse';
import {
  addUsage,
  countOf,
  costOf,
  dayOfMs,
  projectFromCwd,
  statOrNull,
  storeHome,
} from '@/server/lib/usage/sources/helpers';
import type { UsageSource, UsageSourceFile, UsageSourceRead } from '@/server/lib/usage/sources/types';

const HARNESS: HarnessId = 'opencode';

interface MessageRow {
  session_id: string;
  time_created: number;
  data: string;
}

function databasePath(): string {
  return join(storeHome('XDG_DATA_HOME', '.local/share'), 'opencode', 'opencode.db');
}

function projectOf(data: Record<string, unknown>, sessions: Map<string, string>, sessionId: string): string {
  const fromSession = sessions.get(sessionId);
  if (fromSession) return fromSession;
  const path = isRecord(data.path) ? data.path : null;
  return projectFromCwd(path?.cwd) || 'opencode';
}

/** One assistant row's counters, or null when it is not a billed turn. */
function foldAssistant(
  rows: Map<string, UsageRollupRow>,
  sessions: Map<string, string>,
  row: MessageRow,
  data: Record<string, unknown>,
): void {
  const tokens = isRecord(data.tokens) ? data.tokens : null;
  if (!tokens) return;
  const cache = isRecord(tokens.cache) ? tokens.cache : null;
  const input = countOf(tokens.input);
  const output = countOf(tokens.output);
  const reasoning = countOf(tokens.reasoning);
  const cacheRead = countOf(cache?.read);
  const cacheWrite = countOf(cache?.write);
  const total = countOf(tokens.total) || input + output + reasoning + cacheRead + cacheWrite;
  const cost = costOf(data.cost);
  if (total === 0 && cost === 0) return;

  const model = isRecord(data.model) ? data.model : null;
  const provider = typeof model?.providerID === 'string' && model.providerID
    ? model.providerID
    : typeof data.providerID === 'string' && data.providerID ? data.providerID : HARNESS;
  const modelId = typeof model?.modelID === 'string' && model.modelID
    ? model.modelID
    : typeof model?.id === 'string' && model.id
      ? model.id
      : typeof data.modelID === 'string' && data.modelID ? data.modelID : 'unknown';
  const time = isRecord(data.time) ? data.time : null;
  const day = dayOfMs(time?.created) || dayOfMs(row.time_created);

  addUsage(rows, {
    project: projectOf(data, sessions, row.session_id),
    harness: HARNESS,
    provider,
    model: modelId,
    day,
    usage: { input, output, reasoning, cacheRead, cacheWrite, total, cost },
  });
}

function sessionProjects(db: Database): Map<string, string> {
  const projects = new Map<string, string>();
  for (const table of ['session', 'session_v2']) {
    try {
      const rows = db.query(`SELECT id, directory FROM ${table}`).all() as { id: string; directory: string }[];
      for (const row of rows) {
        const project = projectFromCwd(row.directory);
        if (project) projects.set(row.id, project);
      }
      return projects;
    } catch {
      // This install predates (or postdates) the table; the next one answers.
    }
  }
  return projects;
}

/**
 * Fold one OpenCode database.
 *
 * `null` means the database could not be READ at all (locked, corrupt, no
 * message table); the caller then keeps the rows it already had. An empty map
 * would tell the index to delete a chat's history because the agent happened to
 * hold the write lock during a scan.
 */
export function opencodeRowsFromPath(path: string): Map<string, UsageRollupRow> | null {
  const rows = new Map<string, UsageRollupRow>();
  let db: Database | null = null;
  let answered = false;
  try {
    db = new Database(path, { readonly: true });
    db.exec('PRAGMA busy_timeout = 500');
    const sessions = sessionProjects(db);

    const v2Sessions = new Set<string>();
    const v2Rows: MessageRow[] = [];
    try {
      for (const row of db.query('SELECT session_id, time_created, type, data FROM session_message').all() as Array<MessageRow & { type: string }>) {
        v2Sessions.add(row.session_id);
        if (row.type === 'assistant') v2Rows.push(row);
      }
      answered = true;
    } catch {
      // v1-only install.
    }

    for (const row of v2Rows) {
      try {
        const data: unknown = JSON.parse(row.data);
        if (isRecord(data)) foldAssistant(rows, sessions, row, data);
      } catch {
        // A torn row is skipped, never invented.
      }
    }

    let v1Rows: Array<MessageRow & { role?: string }> = [];
    try {
      v1Rows = db.query('SELECT session_id, time_created, data FROM message').all() as Array<MessageRow & { role?: string }>;
      answered = true;
    } catch {
      v1Rows = [];
    }
    for (const row of v1Rows) {
      if (v2Sessions.has(row.session_id)) continue;
      try {
        const data: unknown = JSON.parse(row.data);
        if (isRecord(data) && data.role === 'assistant') foldAssistant(rows, sessions, row, data);
      } catch {
        // Torn row.
      }
    }
  } catch {
    return null;
  } finally {
    db?.close();
  }
  return answered ? rows : null;
}

async function list(): Promise<UsageSourceFile[]> {
  const path = databasePath();
  const stat = await statOrNull(path);
  if (!stat) return [];
  // WAL writes do not touch the main file's mtime, so the -wal sidecar is part
  // of the change signature or a running OpenCode looks unchanged forever.
  const wal = await statOrNull(`${path}-wal`);
  return [{
    key: `opencode:${path}`,
    harness: HARNESS,
    project: 'opencode',
    size: stat.size + (wal?.size ?? 0),
    mtimeMs: Math.max(stat.mtimeMs, wal?.mtimeMs ?? 0),
  }];
}

async function read(file: UsageSourceFile): Promise<UsageSourceRead | null> {
  const path = file.key.slice('opencode:'.length);
  try {
    if (!(await fs.promises.stat(path)).isFile()) return null;
  } catch {
    return null;
  }
  const rows = opencodeRowsFromPath(path);
  return rows ? { rows, nextOffset: file.size, append: false } : null;
}

export const opencodeSource: UsageSource = { id: 'opencode', list, read };
