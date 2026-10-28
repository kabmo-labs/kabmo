/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `artifact://<id>` reference a truncated tool result carries.
 *
 * When omp caps a result it keeps the notice in `details.meta.limits` — the
 * `columnTruncated` entry names the artifact holding the raw stream. Measured
 * over 5,441 real results, 65 carry one and they are the longest outputs in the
 * corpus, so the card can offer a way to read the rest instead of stopping at
 * the 768 bytes the transcript kept.
 *
 * Pure and shared: the card renders the chip, and the panel that opens it needs
 * the same id and kind.
 */

import type { ToolCallData } from '@/shared/types/chat';

export interface ArtifactRef {
  /** Numeric id omp assigned the spill file. */
  id: string;
  /** Tool kind the file belongs to (`bash`, `eval`, `read`, …), when omp said. */
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

/** Walk a `details` bag to the truncation limit omp records, if any. */
export function artifactRefOf(tool: ToolCallData): ArtifactRef | null {
  const details = tool.details;
  if (!details || typeof details !== 'object') return null;
  const meta = (details as Record<string, unknown>).meta;
  if (!meta || typeof meta !== 'object') return null;
  const limits = (meta as Record<string, unknown>).limits;
  if (!limits || typeof limits !== 'object') return null;
  const truncated = (limits as Record<string, unknown>).columnTruncated;
  if (!truncated || typeof truncated !== 'object') return null;
  const record = truncated as Record<string, unknown>;
  const id = typeof record.artifactId === 'string' ? record.artifactId : undefined;
  if (!id || !/^\d+$/.test(id)) return null;
  const elidedBytes = typeof record.artifactElidedBytes === 'number' ? record.artifactElidedBytes : undefined;
  // omp's record names the id and the cap but not the kind — the tool that
  // produced the result is what tells them apart.
  const kind = KIND_BY_TOOL[(tool.name || tool.type || '').toLowerCase()];
  return { id, kind, elidedBytes };
}

/** Request URL for one artifact's full text. */
export function artifactUrl(sessionId: string, ref: ArtifactRef): string {
  const params = new URLSearchParams({ sessionId, id: ref.id });
  if (ref.kind) params.set('kind', ref.kind);
  return `/api/omp/artifact?${params.toString()}`;
}
