/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The right pane of a split editor column.
 *
 * It is a SECOND `Editor`, not a second document list: the pane takes the tab it should
 * show and renders the same panel with that tab forced active. Everything about it — the
 * toolbar, the find bar, the surface, the save path — is the panel the left pane already
 * uses, so a split cannot have a feature the unsplit editor lacks.
 *
 * ## Why a forced `activeFileId` rather than a second tab list
 *
 * The strip stays in the LEFT pane and stays the single owner of the tab order and of
 * `activeFileId`. The right pane is given its own id to render and is told to keep it: a
 * click on its tab strip would move the left pane's active tab, which is the behaviour the
 * user is not asking for when they split.
 *
 * ## Closing the pane closes the VIEW, not the tab
 *
 * The tab stays in the strip, which is what makes the split a layout decision rather than a
 * document one.
 */

import type { ComponentChildren } from 'preact';
import { X } from 'lucide-preact';

interface SplitPaneProps {
  /** The tab's name, for the header that identifies which document this is. */
  fileName: string;
  onClose: () => void;
  children: ComponentChildren;
}

export function SplitPane({ fileName, onClose, children }: SplitPaneProps) {
  return (
    <div className="flex flex-col h-full min-w-0" data-split-pane="">
      <div className="flex items-center justify-between gap-2 px-3 py-1 border-b border-ink/10 bg-canvas flex-shrink-0">
        <span className="text-[11px] font-mono text-ink/60 truncate" title={fileName}>
          {fileName}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="p-0.5 rounded hover:bg-ink/10 text-ink/50 hover:text-ink transition-colors cursor-pointer flex-shrink-0"
          title="Close this pane (the tab stays open)"
          aria-label="Close split pane"
        >
          <X size={12} />
        </button>
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}
