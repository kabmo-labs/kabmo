/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The panel's header: its name, then the scope.
 *
 * Kabmo's panels open with a title row (`h-10 px-3 border-b`), and this
 * one had none — it started straight at the repo picker, so the view was the only
 * one in the right panel that never said what it was. The title takes the same
 * treatment `TerminalHeader` gives its own (`text-xs font-semibold tracking-wider
 * uppercase`) so the two read as the same kind of thing.
 *
 * `showHeader` is the host's own flag, and it is honoured for the reason the
 * terminal honours it: the phone's drawer draws its own tab strip above the view,
 * so a header here would be a second one naming the same panel.
 *
 * The rescan sits at the trailing edge of the title row rather than beside the
 * picker, because it acts on the WHOLE listing — every group — not on the repo
 * the picker just set.
 */

import { RepoPicker, type RepoScopeHandle } from '@kabmo-labs/kabmo-ui';

import { Glyph, ICON } from './Glyph';

export interface PanelHeaderProps {
  /** The shared nested-repo scope, from `useRepoScope()`. */
  scope: RepoScopeHandle;
  /** False in the phone's drawer, which draws its own tab strip. */
  showHeader: boolean;
  onRefresh: () => void;
}

export function PanelHeader({ scope, showHeader, onRefresh }: PanelHeaderProps) {
  if (!showHeader) {
    // Without the title row the picker still has to be reachable, so it stays —
    // one compact row, which is what the drawer's own chrome expects.
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-ink/10 flex-shrink-0">
        <RepoPicker scope={scope} className="min-w-0" />
        <button
          type="button"
          onClick={onRefresh}
          title="Rescan this repository"
          aria-label="Rescan this repository"
          className="ml-auto px-1.5 py-0.5 rounded text-ink/50 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer"
        >
          <Glyph path={ICON.refresh} />
        </button>
      </div>
    );
  }

  return (
    <div className="h-10 px-3 border-b border-ink/10 bg-paper flex items-center justify-between flex-shrink-0 select-none">
      <div className="flex items-center space-x-1.5 min-w-0">
        <Glyph path={ICON.runner} size={14} />
        <span className="text-xs font-semibold tracking-wider text-ink uppercase">Command Runner</span>
      </div>
      <div className="flex items-center space-x-1 min-w-0">
        <RepoPicker scope={scope} className="min-w-0" />
        <button
          type="button"
          onClick={onRefresh}
          title="Rescan this repository"
          aria-label="Rescan this repository"
          className="p-1 rounded text-ink/50 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer"
        >
          <Glyph path={ICON.refresh} />
        </button>
      </div>
    </div>
  );
}
