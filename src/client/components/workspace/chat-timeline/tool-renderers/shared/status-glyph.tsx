/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The status glyph every non-card style uses, and the tone that goes with it.
 *
 * The card spells the outcome as a badge with a word (`Done`, `Failed`,
 * `Running`, `Skipped`, `Aborted`). A one-line style has no room for the word,
 * so the glyph carries it — which makes the glyph load-bearing, not decorative:
 * `aborted` and `skipped` are distinct outcomes omp records, and collapsing
 * either into a check mark would tell the reader the model declined when the
 * user had interrupted. The card's badge rules are mirrored here for that
 * reason (`ToolCardShell`'s `statusBadge`).
 */

import type { ReactNode } from 'preact/compat';
import { AlertCircle, Check, CircleSlash, Loader2, OctagonX } from 'lucide-preact';
import type { ToolCallData } from '@/shared/types';
import { isSkippedTool } from '@/shared/lib/chat/tool-status';

export type ToolStatusTone = 'ok' | 'error' | 'warn' | 'muted';

export interface ToolStatusGlyph {
  /** The glyph itself, sized for a one-line row. */
  glyph: ReactNode;
  tone: ToolStatusTone;
  /** The word a screen reader hears — the glyph is not enough on its own. */
  word: string;
}

/** Tone → text class. `--theme-error` is the only chroma a tool row may use. */
export const STATUS_TONE_CLASS: Record<ToolStatusTone, string> = {
  ok: 'text-success',
  error: 'text-error',
  warn: 'text-warning',
  muted: 'text-ink/30',
};

export function toolStatusGlyph(tool: ToolCallData): ToolStatusGlyph {
  if (tool.status === 'aborted') {
    return { glyph: <OctagonX size={12} />, tone: 'warn', word: 'Aborted' };
  }
  if (isSkippedTool(tool)) {
    return { glyph: <CircleSlash size={12} />, tone: 'muted', word: 'Skipped' };
  }
  const status = tool.status || (tool.error ? 'error' : 'success');
  if (status === 'error') {
    return { glyph: <AlertCircle size={12} />, tone: 'error', word: 'Failed' };
  }
  if (status === 'running') {
    return { glyph: <Loader2 size={12} className="animate-spin" />, tone: 'muted', word: 'Running' };
  }
  return { glyph: <Check size={12} />, tone: 'ok', word: 'Done' };
}
