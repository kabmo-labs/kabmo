/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The strip at the top of a workspace panel.
 *
 * Every right-panel view drew its own header, and each picked its own height
 * and padding: `p-3` on three of them, `p-4` on Context, `px-3.5 py-2.5` on
 * Usage and Todos, `py-1.5` on the wiki. The repo picker is the same control in
 * all of them, so the row around it is one fact: a 40px strip
 * (`CONTROL_ROW_HEIGHT.desktop`, the same constant the panel tab strips read)
 * whose centre is the activity rail's first mark. Stating it once is what keeps
 * the picker on the same line as the rail when a view is switched.
 *
 * The icon controls in `right` are `HeaderButton`/`RefreshButton` from
 * `common/header-button`, so the reload glyph is the same box in a settings
 * pane as it is here.
 *
 * The slots are deliberately dumb. `left` is the picker plus whatever the view
 * needs beside it (a title, a status chip, a provider badge); `right` is the
 * view's own actions. The header owns the height, the border and the padding;
 * it does not own the controls.
 */

import type { ReactNode } from 'preact/compat';
import { CONTROL_ROW_HEIGHT } from '@/client/lib/ui/control-plate';

interface PanelHeaderProps {
  /** The picker and the view's own leading content. */
  left: ReactNode;
  /** The view's actions, right-aligned. */
  right?: ReactNode;
  /** Extra classes on the strip (e.g. `border-b-0` when a row follows). */
  className?: string;
}

export function PanelHeader({ left, right, className = '' }: PanelHeaderProps) {
  return (
    <div
      className={`${CONTROL_ROW_HEIGHT.desktop} flex-shrink-0 px-3 border-b border-ink/10 bg-paper flex items-center justify-between gap-2 select-none ${className}`}
    >
      <div className="flex items-center gap-2 min-w-0">{left}</div>
      {right ? <div className="flex items-center gap-1 flex-shrink-0">{right}</div> : null}
    </div>
  );
}
