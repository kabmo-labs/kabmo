/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Qwen CLI's token log: `QWEN_HOME/usage/token-usage-YYYY-MM.jsonl`.
 *
 * The cleanest of the ACP stores — one record per model request with the model,
 * the token split and the session id. It has no cwd, so the project comes from
 * the session's own chat file under `projects/<encoded-cwd>/chats/<id>.jsonl`.
 *
 * `inputTokens` includes the cached prompt (the log reports `cachedTokens`
 * separately), so the uncached input subtracts it, exactly as the Codex reader
 * does; otherwise cache reads are counted twice in the panel's hit rate.
 */

import { join } from 'node:path';

import type { HarnessId } from '@kabmo-labs/kabmo-harness/catalog';
import { isRecord } from '@kabmo-labs/kabmo-guards';
import type { UsageRollupRow } from '@/server/lib/usage/index-parse';
import {
  addUsage,
  countOf,
  dayOfIso,
  names,
  readdirOrEmpty,
  statOrNull,
  storeHome,
} from '@/server/lib/usage/sources/helpers';
import type { UsageSource, UsageSourceFile, UsageSourceRead } from '@/server/lib/usage/sources/types';

const HARNESS: HarnessId = 'qwen';
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function qwenHome(): string {
  return storeHome('QWEN_HOME', '.qwen');
}

/** `sessionId → project` from the chat files' own folder names. */
async function sessionProjects(): Promise<Map<string, string>> {
  const projects = new Map<string, string>();
  const root = join(qwenHome(), 'projects');
  for (const entry of await readdirOrEmpty(root)) {
    if (!entry.isDirectory()) continue;
    for (const file of await names(join(root, entry.name, 'chats'))) {
      if (!file.endsWith('.jsonl')) continue;
      projects.set(file.slice(0, -'.jsonl'.length), entry.name);
    }
  }
  return projects;
}

/** Fold one monthly usage log. Pure, so a fixture can pin it. */
export function qwenRowsFromText(
  text: string,
  projects: ReadonlyMap<string, string> = new Map(),
): Map<string, UsageRollupRow> {
  const rows = new Map<string, UsageRollupRow>();
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
    if (record.schemaVersion !== undefined && record.schemaVersion !== 1) continue;

    const input = countOf(record.inputTokens);
    const cached = countOf(record.cachedTokens);
    const output = countOf(record.outputTokens);
    const reasoning = countOf(record.thoughtsTokens);
    const total = countOf(record.totalTokens) || input + output + reasoning;
    if (total === 0) continue;

    const sessionId = typeof record.sessionId === 'string' ? record.sessionId : '';
    const localDate = typeof record.localDate === 'string' && ISO_DAY.test(record.localDate) ? record.localDate : '';
    addUsage(rows, {
      project: projects.get(sessionId) ?? HARNESS,
      harness: HARNESS,
      provider: HARNESS,
      model: typeof record.model === 'string' && record.model ? record.model : 'unknown',
      day: localDate || dayOfIso(record.timestamp),
      usage: {
        input: Math.max(0, input - cached),
        cacheRead: cached,
        output,
        reasoning,
        total,
      },
    });
  }
  return rows;
}

async function list(): Promise<UsageSourceFile[]> {
  const root = join(qwenHome(), 'usage');
  const out: UsageSourceFile[] = [];
  for (const name of await names(root)) {
    if (!name.startsWith('token-usage-') || !name.endsWith('.jsonl')) continue;
    const path = join(root, name);
    const stat = await statOrNull(path);
    if (stat) out.push({ key: `qwen:${path}`, harness: HARNESS, project: HARNESS, ...stat });
  }
  return out;
}

async function read(file: UsageSourceFile): Promise<UsageSourceRead | null> {
  let text: string;
  try {
    text = await Bun.file(file.key.slice('qwen:'.length)).text();
  } catch {
    return null;
  }
  return { rows: qwenRowsFromText(text, await sessionProjects()), nextOffset: file.size, append: false };
}

export const qwenSource: UsageSource = { id: 'qwen', list, read };
