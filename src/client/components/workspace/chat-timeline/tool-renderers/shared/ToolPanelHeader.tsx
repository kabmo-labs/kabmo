/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The identity bar a panel puts above its body: which file (or endpoint) the
 * result is about, what kind of thing it is, and the copy control for it.
 *
 * `Read` and `Edit` had each written this bar themselves — the same icon slot,
 * the same truncated mono path, the same badge, the same `CopyButton` — so the
 * two drifted in spacing and badge wording while describing the same thing.
 * One component means a panel cannot show the path in a different place, and a
 * new panel gets the bar instead of inventing a third shape.
 *
 * It is deliberately NOT a card: the enclosing `ToolCardShell` already draws
 * the card, its title and its status. This is the row INSIDE the body.
 */

import type { ReactNode } from 'preact/compat';
import { CopyButton } from '@/client/components/common/CopyButton';

interface ToolPanelHeaderProps {
  /** Leading glyph — a file kind, a folder, an endpoint. */
  icon: ReactNode;
  /** The identity itself: a path, a URL, a directory. */
  label: string;
  /** Kind badge (`TypeScript`, `Directory`, `Edit`), omitted when unknown. */
  badge?: string;
  /** Text the copy control writes; the row is rendered without it when absent. */
  copyText?: string;
  /** Tooltip / accessible name for the copy control. */
  copyLabel?: string;
}

export function ToolPanelHeader({ icon, label, badge, copyText, copyLabel = 'Copy' }: ToolPanelHeaderProps) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-ink/8 bg-paper px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-ink/5 text-ink/70">
          {icon}
        </span>
        <span className="truncate font-mono text-[11px] font-medium text-ink" title={label}>
          {label}
        </span>
        {badge && (
          <span className="shrink-0 rounded bg-ink/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-ink/50">
            {badge}
          </span>
        )}
      </div>

      {copyText && (
        <CopyButton
          text={copyText}
          className="flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-ink/50 transition-colors hover:bg-ink/5 hover:text-ink"
          iconSize={11}
          label={copyLabel}
        />
      )}
    </div>
  );
}
