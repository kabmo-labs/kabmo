/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * omp's own JSONL transcripts — the source the index started with.
 *
 * The only append-only store in the set, so it is the only one that keeps a
 * byte offset. A row in `harness_sessions` tells `omp-rpc` and `omp-acp` apart;
 * a file with no row predates harness tracking and is reported as `omp-rpc`,
 * which is the transport every discovered session ran on.
 */

import fs from 'node:fs';
import { join } from 'node:path';

import { getDb } from '@/server/db.server';
import { getSessionsDir } from '@kabmo-labs/kabmo-omp/paths';
import { completeLineOffset, foldUsageText, type UsageRollupRow } from '@/server/lib/usage/index-parse';
import type { HarnessId } from '@kabmo-labs/kabmo-harness/catalog';
import { statOrNull, readdirOrEmpty } from '@/server/lib/usage/sources/helpers';
import type { UsageSource, UsageSourceFile, UsageSourceRead } from '@/server/lib/usage/sources/types';

/** A transcript larger than this is not a session we can fold cheaply. */
const MAX_TRANSCRIPT_BYTES = 64 * 1024 * 1024;

async function harnessBySession(): Promise<Map<string, HarnessId>> {
  try {
    const db = await getDb();
    const rows = await db.all<{ session_id: string; harness: string }>('SELECT session_id, harness FROM harness_sessions');
    return new Map(rows.map((row) => [row.session_id, row.harness as HarnessId]));
  } catch {
    return new Map();
  }
}

function sessionIdOf(name: string): string {
  return name.endsWith('.jsonl') ? name.slice(0, -'.jsonl'.length) : name;
}

/** Every transcript under the sessions root, with the project folder it lives in. */
export async function listOmpTranscripts(
  root = getSessionsDir(),
  harnesses = new Map<string, HarnessId>(),
): Promise<UsageSourceFile[]> {
  const out: UsageSourceFile[] = [];
  for (const entry of await readdirOrEmpty(root)) {
    const projectPath = join(root, entry.name);
    if (entry.isFile()) {
      // A transcript written directly under the sessions root still belongs to
      // a project: its own name is the only one it has.
      if (!entry.name.endsWith('.jsonl')) continue;
      const stat = await statOrNull(projectPath);
      if (stat) {
        out.push({
          key: projectPath,
          harness: harnesses.get(sessionIdOf(entry.name)) ?? 'omp-rpc',
          project: entry.name,
          ...stat,
        });
      }
      continue;
    }
    if (!entry.isDirectory()) continue;
    let names: string[];
    try {
      names = await fs.promises.readdir(projectPath);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      const path = join(projectPath, name);
      const stat = await statOrNull(path);
      if (stat) {
        out.push({
          key: path,
          harness: harnesses.get(sessionIdOf(name)) ?? 'omp-rpc',
          project: entry.name,
          ...stat,
        });
      }
    }
  }
  return out;
}

export const ompSource: UsageSource = {
  id: 'omp',
  async list() {
    return listOmpTranscripts(getSessionsDir(), await harnessBySession());
  },
  async read(file, previous): Promise<UsageSourceRead | null> {
    const rows = new Map<string, UsageRollupRow>();
    if (file.size > MAX_TRANSCRIPT_BYTES) return null;

    let text: string;
    let append = false;
    let baseOffset = 0;
    // A tail read is only safe once the index has seen the WHOLE file: a row
    // written by an older build may have counted a file the old way, and adding
    // to it would mix two attributions. Starting from 0 also means a truncated
    // or rewritten transcript is rebuilt rather than patched.
    const canAppend = previous !== null && previous.offset > 0 && previous.size === previous.offset;
    try {
      if (previous && canAppend && file.size > previous.size) {
        text = await Bun.file(file.key).slice(previous.size, file.size).text();
        baseOffset = previous.size;
        append = true;
      } else {
        text = await Bun.file(file.key).text();
      }
    } catch {
      return null;
    }

    // A tail read can stop mid-line; keep only whole lines so the next pass
    // resumes at a boundary instead of re-parsing half an entry.
    foldUsageText(rows, file.project, text, append, file.harness);
    const nextOffset = baseOffset + completeLineOffset(text);
    return { rows, nextOffset, append };
  },
};
