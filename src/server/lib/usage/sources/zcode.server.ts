/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * zcode's local database: `ZCODE_HOME/cli/db/db.sqlite`.
 *
 * zcode records one `model_usage` row per model request, already carrying the
 * provider, the model and the token split. `turn_usage` is the same tokens
 * aggregated per turn without a provider/model, so it is deliberately NOT read:
 * folding both would double every number.
 *
 * No cost column exists in either table, so zcode's turns are unpriced rather
 * than free — the panel says which, instead of assuming a rate.
 */

import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import { join } from 'node:path';

import type { HarnessId } from '@kabmo-labs/kabmo-harness-catalog';
import type { UsageRollupRow } from '@/server/lib/usage/index-parse';
import {
  addUsage,
  countOf,
  dayOfMs,
  projectFromCwd,
  statOrNull,
  storeHome,
} from '@/server/lib/usage/sources/helpers';
import type { UsageSource, UsageSourceFile, UsageSourceRead } from '@/server/lib/usage/sources/types';

const HARNESS: HarnessId = 'zcode';

function databasePath(): string {
  return join(storeHome('ZCODE_HOME', '.zcode'), 'cli', 'db', 'db.sqlite');
}

interface ModelUsageRow {
  session_id: string;
  provider_id: string;
  model_id: string;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  computed_total_tokens: number;
  started_at: number;
}

function sessionProjects(db: Database): Map<string, string> {
  const projects = new Map<string, string>();
  try {
    for (const row of db.query('SELECT id, directory FROM session').all() as { id: string; directory: string }[]) {
      const project = projectFromCwd(row.directory);
      if (project) projects.set(row.id, project);
    }
  } catch {
    // No session table: the row still has provider/model, only its project is
    // reported under the harness name.
  }
  return projects;
}

/** Fold one zcode database; `null` means the store could not be read. */
export function zcodeRowsFromPath(path: string): Map<string, UsageRollupRow> | null {
  const rows = new Map<string, UsageRollupRow>();
  let db: Database | null = null;
  try {
    db = new Database(path, { readonly: true });
    db.exec('PRAGMA busy_timeout = 500');
    const projects = sessionProjects(db);
    const usageRows = db.query(
      `SELECT session_id, provider_id, model_id, input_tokens, output_tokens, reasoning_tokens,
              cache_creation_input_tokens, cache_read_input_tokens, computed_total_tokens, started_at
         FROM model_usage`,
    ).all() as ModelUsageRow[];

    for (const row of usageRows) {
      const input = countOf(row.input_tokens);
      const output = countOf(row.output_tokens);
      const reasoning = countOf(row.reasoning_tokens);
      const cacheWrite = countOf(row.cache_creation_input_tokens);
      const cacheRead = countOf(row.cache_read_input_tokens);
      const total = countOf(row.computed_total_tokens) || input + output + reasoning + cacheWrite + cacheRead;
      if (total === 0) continue;
      addUsage(rows, {
        project: projects.get(row.session_id) ?? HARNESS,
        harness: HARNESS,
        provider: row.provider_id || HARNESS,
        model: row.model_id || 'unknown',
        day: dayOfMs(row.started_at),
        usage: { input, output, reasoning, cacheRead, cacheWrite, total },
      });
    }
  } catch {
    return null;
  } finally {
    db?.close();
  }
  return rows;
}

async function list(): Promise<UsageSourceFile[]> {
  const path = databasePath();
  const stat = await statOrNull(path);
  if (!stat) return [];
  const wal = await statOrNull(`${path}-wal`);
  return [{
    key: `zcode:${path}`,
    harness: HARNESS,
    project: 'zcode',
    size: stat.size + (wal?.size ?? 0),
    mtimeMs: Math.max(stat.mtimeMs, wal?.mtimeMs ?? 0),
  }];
}

async function read(file: UsageSourceFile): Promise<UsageSourceRead | null> {
  const path = file.key.slice('zcode:'.length);
  try {
    if (!(await fs.promises.stat(path)).isFile()) return null;
  } catch {
    return null;
  }
  const rows = zcodeRowsFromPath(path);
  return rows ? { rows, nextOffset: file.size, append: false } : null;
}

export const zcodeSource: UsageSource = { id: 'zcode', list, read };
