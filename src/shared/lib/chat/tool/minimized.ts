/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The shell minimizer's rewrite of a `bash` result (omp 18.16.0).
 *
 * omp compresses verbose command output (git, npm, cargo, …) before returning it
 * to the model and records what it did in `details.meta.minimized`:
 *
 *   { filter: "git", inputBytes: 10970, outputBytes: 3905, artifactId: "0" }
 *
 * `artifactId` names the LOSSLESS original under the `bash-original` artifact
 * kind — the rewrite itself is lossy — so the card can offer the raw stream.
 * Measured on a child running `git --no-pager log` in a 60-commit repo: the
 * field arrives on the live `bash` result AND on the reloaded transcript's
 * `toolResult.details.meta`, so both paths read it here.
 *
 * omp's own TUI states the same three facts (`Minimized: git 120.4KB → 3.2KB`
 * in `formatMinimizedMeta`); Kabmo states them from the wire values so the card
 * cannot disagree with what it renders.
 *
 * Pure and shared: no mounting, no DOM.
 */

import type { ToolCallData } from '@/shared/types/chat';
import { formatToolBytes } from '@/shared/lib/chat/tool/labels';

export interface MinimizedOutput {
  /** The minimizer filter that ran (`git`, `npm`, `cargo`, …). */
  filter: string;
  /** Bytes the command produced. */
  inputBytes: number;
  /** Bytes the rewrite kept. */
  outputBytes: number;
  /** Artifact holding the lossless original, when omp saved one. */
  artifactId?: string;
}

/** Record `minimized` on a `bash`/`terminal` result, or null when there is none. */
export function minimizedOutputOf(tool: ToolCallData): MinimizedOutput | null {
  const details = tool.details;
  if (!details || typeof details !== 'object') return null;
  const meta = details.meta;
  if (!meta || typeof meta !== 'object') return null;
  const record = (meta as Record<string, unknown>).minimized;
  if (!record || typeof record !== 'object') return null;
  const value = record as Record<string, unknown>;
  const filter = typeof value.filter === 'string' && value.filter.trim() ? value.filter.trim() : undefined;
  const inputBytes = typeof value.inputBytes === 'number' && Number.isFinite(value.inputBytes) ? value.inputBytes : undefined;
  const outputBytes =
    typeof value.outputBytes === 'number' && Number.isFinite(value.outputBytes) ? value.outputBytes : undefined;
  // A record without the two sizes cannot be stated honestly — "→ 0 B" would be
  // a claim about a number omp did not send.
  if (!filter || inputBytes === undefined || outputBytes === undefined) return null;
  const artifactId = typeof value.artifactId === 'string' && /^\d+$/.test(value.artifactId) ? value.artifactId : undefined;
  return { filter, inputBytes, outputBytes, ...(artifactId ? { artifactId } : {}) };
}

/** `git 10.7 KB → 3.8 KB` — the filter that ran and what it saved. */
export function minimizedLabel(minimized: MinimizedOutput): string {
  return `${minimized.filter} ${formatToolBytes(minimized.inputBytes)} → ${formatToolBytes(minimized.outputBytes)}`;
}
