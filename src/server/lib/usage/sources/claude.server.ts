/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Claude Code's transcript: `~/.claude/projects/<encoded-cwd>/<session>.jsonl`.
 *
 * Two record kinds carry usage, and they answer different questions:
 *  - each `assistant` row has the turn's own tokens (`message.usage`);
 *  - the final `cost-state` row has the session's per-model cost, which the
 *    per-turn rows do not carry at all.
 *
 * So tokens are counted per turn and cost is added once, under the session's
 * scrollback model. Folding the cost-state's tokens too would double every
 * number in the panel; dropping its cost would report a priced session as
 * unpriced. A row with tokens and no cost stays unpriced — the panel's own rule.
 */

import fs from 'node:fs';
import { join } from 'node:path';

import type { HarnessId } from '@kabmo-labs/kabmo-harness/catalog';
import { isRecord } from '@kabmo-labs/kabmo-guards';
import type { UsageRollupRow } from '@/server/lib/usage/index-parse';
import {
  addCostOnly,
  addUsage,
  countOf,
  costOf,
  dayOfIso,
  dayOfMs,
  isEmptyUsage,
  projectFromCwd,
  statOrNull,
  storeHome,
  names,
} from '@/server/lib/usage/sources/helpers';
import type { UsageSource, UsageSourceFile, UsageSourceRead } from '@/server/lib/usage/sources/types';

const HARNESS: HarnessId = 'claude';

/** Anthropic reports cache creation in one total plus optional TTL buckets. */
function cacheWriteOf(usage: Record<string, unknown>): number {
  const total = countOf(usage.cache_creation_input_tokens);
  if (total > 0) return total;
  const detail = isRecord(usage.cache_creation) ? usage.cache_creation : {};
  return countOf(detail.ephemeral_5m_input_tokens) + countOf(detail.ephemeral_1h_input_tokens);
}

/** Tokens and cost from one Claude transcript body. Pure, so it is testable. */
export function claudeRowsFromText(
  text: string,
  fallbackProject: string,
): { rows: Map<string, UsageRollupRow>; project: string } {
  const rows = new Map<string, UsageRollupRow>();
  const seen = new Set<string>();
  let project = fallbackProject;
  let lastDay = '';
  let costState: Record<string, unknown> | null = null;

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

    const cwd = projectFromCwd(record.cwd);
    if (cwd && (!fallbackProject || fallbackProject.startsWith('-'))) project = cwd;

    if (record.type === 'cost-state') {
      // Cumulative: only the LAST one describes the session. Earlier rows are
      // snapshots of the same run.
      costState = record;
      continue;
    }
    if (record.type !== 'assistant' || !isRecord(record.message)) continue;
    const usage = record.message.usage;
    if (!isRecord(usage)) continue;

    const messageId = typeof record.message.id === 'string'
      ? record.message.id
      : typeof record.uuid === 'string' ? record.uuid : '';
    if (messageId) {
      if (seen.has(messageId)) continue;
      seen.add(messageId);
    }

    const numbers = {
      input: countOf(usage.input_tokens),
      output: countOf(usage.output_tokens),
      cacheRead: countOf(usage.cache_read_input_tokens),
      cacheWrite: cacheWriteOf(usage),
      reasoning: isRecord(usage.output_tokens_details)
        ? countOf(usage.output_tokens_details.reasoning_tokens) ||
          countOf(usage.output_tokens_details.thinking_tokens)
        : 0,
    };
    if (isEmptyUsage(numbers)) continue;
    const day = dayOfIso(record.timestamp);
    if (day) lastDay = day;
    addUsage(rows, {
      project,
      harness: HARNESS,
      provider: HARNESS,
      model: typeof record.message.model === 'string' && record.message.model ? record.message.model : 'unknown',
      day,
      usage: { ...numbers, total: numbers.input + numbers.output + numbers.cacheRead + numbers.cacheWrite },
    });
  }

  if (costState) {
    // The cost-state is a session total with no day of its own. The last turn
    // is the day the session was actually spending on; its `startTime` is only
    // a fallback for a file whose assistant rows were rotated away.
    const day = lastDay || dayOfMs(costState.startTime) || dayOfIso(costState.timestamp);
    const modelUsage = isRecord(costState.modelUsage) ? costState.modelUsage : null;
    if (modelUsage) {
      for (const [model, entry] of Object.entries(modelUsage)) {
        if (!isRecord(entry)) continue;
        addCostOnly(rows, {
          project,
          harness: HARNESS,
          provider: HARNESS,
          model,
          day,
          cost: costOf(entry.costUSD),
        });
      }
    } else {
      addCostOnly(rows, {
        project,
        harness: HARNESS,
        provider: HARNESS,
        model: 'unknown',
        day,
        cost: costOf(costState.totalCostUSD),
      });
    }
  }

  return { rows, project };
}

/** Claude's root: `CLAUDE_CONFIG_DIR` or `~/.claude`. */
function claudeHome(): string {
  return storeHome('CLAUDE_CONFIG_DIR', '.claude');
}

async function list(): Promise<UsageSourceFile[]> {
  const root = join(claudeHome(), 'projects');
  const out: UsageSourceFile[] = [];
  for (const project of await names(root)) {
    const dir = join(root, project);
    let files: string[];
    try {
      files = await fs.promises.readdir(dir);
    } catch {
      continue;
    }
    for (const name of files) {
      if (!name.endsWith('.jsonl')) continue;
      const path = join(dir, name);
      const stat = await statOrNull(path);
      if (stat) out.push({ key: `claude:${path}`, harness: HARNESS, project, ...stat });
    }
  }
  return out;
}

async function read(file: UsageSourceFile): Promise<UsageSourceRead | null> {
  let text: string;
  try {
    text = await Bun.file(file.key.slice('claude:'.length)).text();
  } catch {
    return null;
  }
  const parsed = claudeRowsFromText(text, file.project);
  return { rows: parsed.rows, nextOffset: file.size, append: false };
}

export const claudeSource: UsageSource = { id: 'claude', list, read };
