/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The header of one pane in Settings → Plugins.
 *
 * The plugin detail pane and the marketplace pane are the two halves of the
 * same master-detail, and each drew its own header: one a `flex` row with an
 * actions cluster, the other a bare stack with no row. They were the same
 * title/subtitle/description shape with different wrappers, so the pane switch
 * moved the title and the border by a few pixels. One component states the
 * shape once; the slots say what fills it.
 */

import type { ReactNode } from 'preact/compat';

interface PluginPaneHeaderProps {
  title: string;
  /** The one-line scope/version line under the title. */
  subtitle?: ReactNode;
  /** The longer description, drawn below the subtitle. */
  description?: ReactNode;
  /** The pane's actions, right-aligned. */
  actions?: ReactNode;
}

export function PluginPaneHeader({ title, subtitle, description, actions }: PluginPaneHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 pb-4 border-b border-ink/10">
      <div className="min-w-0">
        <h2 className="text-sm font-bold tracking-tight text-ink truncate">{title}</h2>
        {subtitle ? <p className="text-xs text-ink/60 mt-0.5 truncate">{subtitle}</p> : null}
        {description ? <div className="text-xs text-ink/70 mt-2 leading-relaxed">{description}</div> : null}
      </div>
      {actions ? <div className="flex items-center gap-2 flex-shrink-0">{actions}</div> : null}
    </div>
  );
}
