/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The filesystem half of the capture layer: reading a file, statting it, and
 * the two constants that decide when a tool or a command is worth a note.
 *
 * `displayPathFor` is the one display rule: a path inside the session cwd is
 * shown relative with `/` separators, anything else stays absolute. The chat
 * list and the diff header both read it, so a Windows `src\a.ts` never appears
 * beside a forward-slash path from another producer.
 */

import { stat } from 'node:fs/promises';
import path from 'node:path';
import { isRecord } from '@/shared/lib/util/guards';
import type { AgentEvent } from '@/server/lib/omp/rpc/constants';
import type { ShellTrace } from '@/server/lib/changes/capture-types';

/** A tool whose name promises a write; only these earn an `unknown-tool` note. */
export const MUTATING_TOOL = /(edit|write|replace|patch|create|delete|remove|move|rename|apply|insert|append)/i;

/**
 * An opaque command worth a filesystem snapshot. A test runner is opaque but
 * usually does not rewrite the tree, and scanning on every `bun test` would
 * cost two git processes per run; a reset, an install or a script is the case
 * the scan exists for.
 */
export const SCAN_COMMAND = /^(?:git\s+(?:reset|clean|checkout|restore|stash|apply|rebase|merge|pull|cherry-pick|revert)|(?:npm|pnpm|yarn|bun)\s+(?:install|i|add|remove|uninstall)|make|cargo\s+(?:build|run)|go\s+(?:build|run)|(?:sh|bash|zsh|python3?|node)\s)/;

export async function defaultReadFile(absolute: string): Promise<string | null> {
  try {
    return await Bun.file(absolute).text();
  } catch {
    return null;
  }
}

export async function defaultStatFile(absolute: string): Promise<{ mtimeMs: number; size: number; birthtimeMs: number } | null> {
  try {
    const info = await stat(absolute);
    return { mtimeMs: info.mtimeMs, size: info.size, birthtimeMs: info.birthtimeMs };
  } catch {
    return null;
  }
}

/** `path` relative to the session cwd when inside it, else unchanged. */
export function displayPathFor(absolute: string, cwd: string): string {
  const relative = path.relative(cwd, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return absolute;
  return relative.replaceAll('\\', '/');
}

/** The shell trace on a `bash` result, wherever the transport nested it. */
export function extractTrace(event: AgentEvent): ShellTrace | null {
  const result = isRecord(event.result) ? event.result : undefined;
  const nested = result && isRecord(result.details) ? result.details : undefined;
  const details = nested ?? (isRecord(event.details) ? event.details : undefined);
  const trace = details && isRecord(details.trace) ? details.trace : undefined;
  return trace ? (trace as ShellTrace) : null;
}
