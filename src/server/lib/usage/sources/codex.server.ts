/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Codex's rollout files under `~/.codex/sessions`, one per chat.
 *
 * Codex reports a `token_count` event per model request. `last_token_usage` is
 * that request's delta and is what this index sums; `total_token_usage` is the
 * session's running total and summing it per event would count the same tokens
 * once per turn. Older rollouts write only the total, so the parser keeps a
 * previous total and folds the difference.
 *
 * The rollout also names the model (`turn_context`) and the credential's
 * provider (`session_meta.model_provider`), which is the attribution the panel
 * needs; Codex reports no cost, so its turns are unpriced rather than free.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import { codexHome } from '@kabmo-labs/kabmo-harness-local-transcript/codex-transcript';
import { isRecord } from '@kabmo-labs/kabmo-guards';
import { dayOfIso, addUsage, countOf, projectFromCwd, statOrNull } from '@/server/lib/usage/sources/helpers';
import type { UsageRollupRow } from '@/server/lib/usage/index-parse';
import type { UsageSource, UsageSourceFile, UsageSourceRead } from '@/server/lib/usage/sources/types';
import type { HarnessId } from '@kabmo-labs/kabmo-harness-catalog';

const HARNESS: HarnessId = 'codex';

/** Fold one Codex rollout body. Pure, so the arithmetic is testable. */
export function codexRowsFromText(
  text: string,
  fallbackProject: string,
): { rows: Map<string, UsageRollupRow>; project: string } {
  const rows = new Map<string, UsageRollupRow>();
  let project = fallbackProject;
  let provider = HARNESS;
  let model = 'unknown';
  let previousTotal = 0;

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
    const payload = isRecord(record.payload) ? record.payload : null;
    if (!payload) continue;

    if (record.type === 'session_meta') {
      const cwd = projectFromCwd(payload.cwd);
      if (cwd) project = cwd;
      if (typeof payload.model_provider === 'string' && payload.model_provider) provider = payload.model_provider;
      continue;
    }
    if (record.type === 'turn_context') {
      if (typeof payload.model === 'string' && payload.model) model = payload.model;
      continue;
    }
    if (record.type !== 'event_msg' || payload.type !== 'token_count') continue;
    const info = isRecord(payload.info) ? payload.info : null;
    if (!info) continue;

    const totalUsage = isRecord(info.total_token_usage) ? info.total_token_usage : null;
    const lastUsage = isRecord(info.last_token_usage) ? info.last_token_usage : null;
    const usage = lastUsage ?? totalUsage;
    if (!usage) continue;

    const totalTokens = countOf(usage.total_tokens);
    let numbers = {
      input: countOf(usage.input_tokens),
      cacheRead: countOf(usage.cached_input_tokens),
      cacheWrite: countOf(usage.cache_write_input_tokens),
      output: countOf(usage.output_tokens),
      reasoning: countOf(usage.reasoning_output_tokens),
    };
    // `last_token_usage` is a delta; a total-only rollout needs the difference
    // from the previous event or every turn is counted again.
    if (!lastUsage && totalUsage) {
      const delta = Math.max(0, totalTokens - previousTotal);
      previousTotal = Math.max(previousTotal, totalTokens);
      if (delta === 0) continue;
      numbers = { input: delta, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 };
    }
    if (totalUsage) previousTotal = Math.max(previousTotal, countOf(totalUsage.total_tokens));

    // Codex's `input_tokens` includes the cached prompt; the panel's input is
    // the uncached remainder, or cache reads are counted twice in the rate.
    const input = Math.max(0, numbers.input - numbers.cacheRead);
    const sum = input + numbers.output + numbers.cacheRead + numbers.cacheWrite;
    if (sum === 0) continue;

    addUsage(rows, {
      project,
      harness: HARNESS,
      provider,
      model,
      day: dayOfIso(record.timestamp),
      usage: {
        input,
        output: numbers.output,
        cacheRead: numbers.cacheRead,
        cacheWrite: numbers.cacheWrite,
        reasoning: numbers.reasoning,
        // A delta row has no per-request total to trust; a `last_token_usage`
        // row does.
        total: lastUsage ? totalTokens || sum : sum,
      },
    });
  }

  return { rows, project };
}

async function root(): Promise<string> {
  const home = await codexHome();
  const testRoot = Bun.env.KABMO_USAGE_ACP_ROOT?.trim();
  // The shared reader has no test hook; when it fell back to the real home and
  // the suite redirected ACP stores, follow the redirect.
  return testRoot && home === join(homedir(), '.codex') ? join(testRoot, '.codex') : home;
}

async function list(): Promise<UsageSourceFile[]> {
  const home = await root();
  const out: UsageSourceFile[] = [];
  try {
    for (const path of new Bun.Glob('sessions/**/rollout-*.jsonl').scanSync({ cwd: home, absolute: true, onlyFiles: true })) {
      const stat = await statOrNull(path);
      if (stat) out.push({ key: `codex:${path}`, harness: HARNESS, project: 'codex', ...stat });
    }
  } catch {
    // An absent store is not a scan failure; it contributes nothing.
    return [];
  }
  return out;
}

async function read(file: UsageSourceFile): Promise<UsageSourceRead | null> {
  let text: string;
  try {
    text = await Bun.file(file.key.slice('codex:'.length)).text();
  } catch {
    return null;
  }
  const parsed = codexRowsFromText(text, file.project);
  return { rows: parsed.rows, nextOffset: file.size, append: false };
}

export const codexUsageSource: UsageSource = { id: 'codex', list, read };
