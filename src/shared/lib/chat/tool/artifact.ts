/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `artifact://<id>` reference a rewritten or truncated tool result carries.
 *
 * Two records name one, and both are read here:
 *
 *  - `details.meta.minimized.artifactId` — the LOSSLESS original behind a shell
 *    minimizer rewrite (omp 18.16.0). The inline body is the compressed text, so
 *    this is the only way back to what the command actually printed.
 *  - `details.meta.limits.columnTruncated.artifactId` — the raw stream behind a
 *    capped result. Measured over 5,441 real results, 65 carry one and they are
 *    the longest outputs in the corpus, so the card can offer a way to read the
 *    rest instead of stopping at the 768 bytes the transcript kept.
 *
 * The minimized original wins when both are present: it holds the command's
 * own bytes, while the truncated record only ever holds the stream omp already
 * rewrote.
 *
 * Pure and shared: the card renders the chip, and the panel that opens it needs
 * the same id and kind.
 */

import type { ToolCallData } from '@/shared/types/chat';

export interface ArtifactRef {
  /** Numeric id omp assigned the spill file. */
  id: string;
  /** Tool kind the file belongs to (`bash`, `bash-original`, `eval`, `read`, …), when omp said. */
  kind?: string;
  /** How many bytes were dropped from the inline copy, when omp reported it. */
  elidedBytes?: number;
}

/** omp's artifact kind for a tool, so the reader probes one file, not five. */
const KIND_BY_TOOL: Record<string, string> = {
  bash: 'bash',
  terminal: 'bash',
  run_command: 'bash',
  eval: 'eval',
  read: 'read',
  read_file: 'read',
  view_file: 'read',
};

/** The kind holding the pre-minimizer stream, written only by the `bash` tool. */
const ORIGINAL_KIND_BY_TOOL: Record<string, string> = {
  bash: 'bash-original',
  terminal: 'bash-original',
  run_command: 'bash-original',
};

/** A numeric id, or undefined — anything else could never name a file. */
function numericId(value: unknown): string | undefined {
  return typeof value === 'string' && /^\d+$/.test(value) ? value : undefined;
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

/** Walk a `details` bag to the artifact omp recorded, if any. */
export function artifactRefOf(tool: ToolCallData): ArtifactRef | null {
  const details = tool.details;
  if (!details || typeof details !== 'object') return null;
  const meta = recordOf((details as Record<string, unknown>).meta);
  if (!meta) return null;
  const key = (tool.name || tool.type || '').toLowerCase();

  // The minimizer's own record is a rewrite, not a truncation: the bytes it
  // dropped are `inputBytes - outputBytes`, and the file holds them all.
  const minimized = recordOf(meta.minimized);
  const originalId = numericId(minimized?.artifactId);
  if (originalId) {
    const inputBytes = typeof minimized?.inputBytes === 'number' ? minimized.inputBytes : undefined;
    const outputBytes = typeof minimized?.outputBytes === 'number' ? minimized.outputBytes : undefined;
    const saved = inputBytes !== undefined && outputBytes !== undefined && inputBytes > outputBytes
      ? inputBytes - outputBytes
      : undefined;
    return { id: originalId, kind: ORIGINAL_KIND_BY_TOOL[key], elidedBytes: saved };
  }

  const limits = recordOf(meta.limits);
  const truncated = recordOf(limits?.columnTruncated);
  const id = numericId(truncated?.artifactId);
  if (!id) return null;
  const elidedBytes = typeof truncated?.artifactElidedBytes === 'number' ? truncated.artifactElidedBytes : undefined;
  // omp's record names the id and the cap but not the kind — the tool that
  // produced the result is what tells them apart.
  return { id, kind: KIND_BY_TOOL[key], elidedBytes };
}

/** Request URL for one artifact's full text. */
export function artifactUrl(sessionId: string, ref: ArtifactRef): string {
  const params = new URLSearchParams({ sessionId, id: ref.id });
  if (ref.kind) params.set('kind', ref.kind);
  return `/api/omp/artifact?${params.toString()}`;
}
