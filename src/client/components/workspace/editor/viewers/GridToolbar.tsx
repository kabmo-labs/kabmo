/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The strip above the grid: the selection's address, whatever the caller adds
 * (a workbook's Save), and the copy button.
 *
 * Split from `DataGrid` so the grid's own file stays under the repository's
 * line ceiling, and because the strip is the one part of the grid that is pure
 * presentation — it owns no selection and no clipboard state.
 */

import type { ComponentChildren } from 'preact';
import { Check, Copy } from 'lucide-preact';

export type CopyState = 'idle' | 'copied' | 'failed' | 'refused';

interface GridToolbarProps {
  /** The selection's address and size, or the empty-selection hint. */
  status: string;
  /** A refusal or a warning is drawn in the warning colour. */
  tone?: 'muted' | 'warning';
  /** Caller-owned controls, drawn before the copy button. */
  actions?: ComponentChildren;
  canCopy: boolean;
  copyState: CopyState;
  onCopy: () => void;
}

export function GridToolbar({ status, tone = 'muted', actions, canCopy, copyState, onCopy }: GridToolbarProps) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-ink/10 bg-canvas px-2 py-1 font-sans text-[11px]">
      <span className={`truncate ${tone === 'warning' ? 'text-warning' : 'text-ink/50'}`}>{status}</span>
      <div className="flex shrink-0 items-center gap-2">
        {actions}
        <button
          type="button"
          onClick={onCopy}
          disabled={!canCopy}
          title="Copy the selected cells as tab-separated text"
          className={`flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors ${
            canCopy ? 'text-ink/60 hover:bg-ink/5 hover:text-ink' : 'cursor-default text-ink/25'
          } ${copyState === 'failed' ? 'text-error' : ''}`}
        >
          {copyState === 'copied' ? <Check size={12} /> : <Copy size={12} />}
          <span>{copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy'}</span>
        </button>
      </div>
    </div>
  );
}
