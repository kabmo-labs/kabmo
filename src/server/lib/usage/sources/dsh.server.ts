/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * dsh's transcript: `DSH_HOME/sessions/<project>/<session>/session.v4.jsonl.zstd`.
 *
 * One zstd frame per session, rewritten as the turn advances, so it is always a
 * full read. Assistant messages carry the provider/model on `message.source` and
 * the token split on `data.usage`; dsh records no cost.
 */

import fs from 'node:fs';
import { join } from 'node:path';

import type { HarnessId } from '@/shared/lib/harness/catalog';
import { isRecord } from '@/shared/lib/util/guards';
import type { UsageRollupRow } from '@/server/lib/usage/index-parse';
import {
  addUsage,
  countOf,
  dayOfMs,
  projectFromCwd,
  readdirOrEmpty,
  statOrNull,
  storeHome,
} from '@/server/lib/usage/sources/helpers';
import type { UsageSource, UsageSourceFile, UsageSourceRead } from '@/server/lib/usage/sources/types';

const HARNESS: HarnessId = 'dsh';

/** Fold one decompressed dsh session. Pure, so a fixture can pin it. */
export function dshRowsFromText(
  text: string,
  fallbackProject: string,
): { rows: Map<string, UsageRollupRow>; project: string } {
  const rows = new Map<string, UsageRollupRow>();
  let project = fallbackProject;

  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    let record: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) continue;
      record = parsed;
    } catch {
      continue;
    }

    if (record.type === 'session') {
      const cwd = projectFromCwd(record.cwd);
      if (cwd) project = cwd;
      continue;
    }
    const data = isRecord(record.data) ? record.data : null;
    if (!data || record.type !== 'assistant/message') continue;

    const usage = isRecord(data.usage) ? data.usage : null;
    const message = isRecord(data.message) ? data.message : null;
    const source = isRecord(message?.source) ? message.source : null;
    if (!usage) continue;

    const numbers = {
      input: countOf(usage.inputTokens),
      output: countOf(usage.outputTokens),
      reasoning: countOf(usage.reasoningTokens),
      cacheRead: countOf(usage.cacheReadTokens) || countOf(usage.cachedInputTokens),
      cacheWrite: countOf(usage.cacheWriteTokens),
    };
    const total = countOf(usage.totalTokens) || numbers.input + numbers.output + numbers.cacheRead + numbers.cacheWrite;
    if (total === 0) continue;

    addUsage(rows, {
      project,
      harness: HARNESS,
      provider: typeof source?.provider === 'string' && source.provider ? source.provider : HARNESS,
      model: typeof source?.model === 'string' && source.model ? source.model : 'unknown',
      day: dayOfMs(record.time),
      usage: { ...numbers, total },
    });
  }

  return { rows, project };
}

function sessionsRoot(): string {
  return join(storeHome('DSH_HOME', '.dsh'), 'sessions');
}

async function list(): Promise<UsageSourceFile[]> {
  const root = sessionsRoot();
  const out: UsageSourceFile[] = [];
  for (const entry of await readdirOrEmpty(root)) {
    if (!entry.isDirectory()) continue;
    const projectDir = join(root, entry.name);
    for (const session of await readdirOrEmpty(projectDir)) {
      if (!session.isDirectory()) continue;
      const path = join(projectDir, session.name, 'session.v4.jsonl.zstd');
      const stat = await statOrNull(path);
      if (stat) out.push({ key: `dsh:${path}`, harness: HARNESS, project: entry.name, ...stat });
    }
  }
  return out;
}

async function read(file: UsageSourceFile): Promise<UsageSourceRead | null> {
  let text: string;
  try {
    const bytes = new Uint8Array(await fs.promises.readFile(file.key.slice('dsh:'.length)));
    text = new TextDecoder().decode(Bun.zstdDecompressSync(bytes));
  } catch {
    return null;
  }
  const parsed = dshRowsFromText(text, file.project);
  return { rows: parsed.rows, nextOffset: file.size, append: false };
}

export const dshSource: UsageSource = { id: 'dsh', list, read };
