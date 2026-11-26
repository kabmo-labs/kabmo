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
import { isRecord } from '@kabmo-labs/kabmo-guards';
import type { AgentEvent } from '@kabmo-labs/kabmo-omp/rpc-protocol/constants';
import type { ShellTrace } from '@/server/lib/changes/capture-types';

/** A tool whose name promises a write; only these earn an `unknown-tool` note. */
export const MUTATING_TOOL = /(edit|write|replace|patch|create|delete|remove|move|rename|apply|insert|append)/i;

export async function defaultReadFile(absolute: string): Promise<string | null> {
  try {
    return await Bun.file(absolute).text();
  } catch {
    return null;
  }
}

export async function defaultStatFile(absolute: string): Promise<{ mtimeMs: number; size: number; birthtimeMs: number; isDirectory: boolean } | null> {
  try {
    const info = await stat(absolute);
    return { mtimeMs: info.mtimeMs, size: info.size, birthtimeMs: info.birthtimeMs, isDirectory: info.isDirectory() };
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
