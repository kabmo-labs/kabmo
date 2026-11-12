/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor toolbar's controls, as data plus the button markup each one draws.
 *
 * Split out of `Toolbar.tsx` for the repository's per-file ceiling, and it earns
 * the boundary: the toolbar is a row of clusters with a hiding order, and every
 * control is the same shape — a label, an icon, a pressed state, and the same
 * `aria-*` pair. Keeping the cluster table beside the buttons is what stops the two
 * from disagreeing about which control is pinned.
 *
 * ## Two rules the row exists to enforce
 *
 * **Every action is an icon-only `<button>` carrying both a `title` and an
 * `aria-label`** — a bare `<svg onClick>` is unreachable by keyboard and invisible
 * to a screen reader. **Pinning is not the visual order**: `pinned` marks what a
 * narrow panel must not bury, and the row is placed in the order a reader looks.
 *
 * **Reload is deliberately never pinned.** With a dirty buffer it is the only
 * destructive control in the row, and a `⋯` menu is exactly the friction a
 * destructive action should have; a clean buffer reloads without losing anything.
 */

import type { ComponentChildren } from 'preact';
import {
  Copy,
  Download,
  GitCommitVertical,
  Maximize,
  Minimize,
  RefreshCw,
  Search,
  WrapText,
  ZoomIn,
  ZoomOut,
} from 'lucide-preact';

import type { ToolbarCluster } from '@/client/components/common/toolbar-row';
import {
  previewClusters,
  reviewCluster,
  writeClusters,
} from '@/client/components/workspace/editor/toolbar-write-clusters';
import { ACTION_CLASS, Toggle } from '@/client/components/workspace/editor/toolbar-toggle';

/** The state the toolbar draws, already resolved by the caller. */
export interface ToolbarState {
  byteViewer: boolean;
  hasPreview: boolean;
  isPreview: boolean;
  /** The file has annotatable blocks (markdown) and a rendered preview to judge. */
  hasReview: boolean;
  /** Review mode is on, so the button reads as pressed. */
  isReviewing: boolean;
  wordWrap: boolean;
  /** The inline blame label is drawn (the setting, not whether a file has blame). */
  blameInline: boolean;
  findOpen: boolean;
  copied: boolean;
  isMaximized: boolean;
  saveDisabled: boolean;
  canReload: boolean;
  /** A re-read is in flight, so the Reload glyph spins while it lands. */
  refreshing: boolean;
  /** The buffer has edits, so Reload discards them — the title says so. */
  reloadDiscardsEdits: boolean;
  saveButton: ComponentChildren;
  previewLabel: string;
  findLabel: string;
  wordWrapLabel: string;
  copyLabel: string;
  maximizeLabel: string;
  onTogglePreview: () => void;
  onToggleReview: () => void;
  onToggleFind: () => void;
  onToggleWordWrap: () => void;
  onToggleBlameInline: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onReload: () => void;
  onSaveAs: () => void;
  onToggleMaximize: () => void;
  onSave: () => void;
  viewModeActions: ToolbarCluster['actions'];
  maximizeButton: ComponentChildren;
  viewModeButtons: ComponentChildren;
}

/**
 * The clusters, in hiding order.
 *
 * ORDER is the hiding order, most important first: the row keeps the width modes
 * and full screen (the controls this panel is FOR), then copy/download, and the
 * reading aids (find, wrap, zoom, preview) move into the `⋯` menu on a narrow
 * panel. Grouping is the existing one — zoom is a pair, copy/download is a pair,
 * the modes are a pair — because splitting a pair leaves half of it on the row.
 */
export function buildEditorClusters(state: ToolbarState): ToolbarCluster[] {
  const clusters: ToolbarCluster[] = [];

  clusters.push(...writeClusters(state), ...reviewCluster(state), ...previewClusters(state));

  if (!state.byteViewer) {
    clusters.push({
      id: 'find',
      actions: [{ label: state.findLabel, icon: Search, onSelect: state.onToggleFind, active: state.findOpen }],
      children: (
        <Toggle
          label={state.findLabel}
          pressed={state.findOpen}
          title={`${state.findLabel} (Ctrl+F)`}
          onClick={state.onToggleFind}
        >
          <Search size={14} />
        </Toggle>
      ),
    });
    clusters.push({
      id: 'wrap',
      actions: [
        { label: state.wordWrapLabel, icon: WrapText, onSelect: state.onToggleWordWrap, active: state.wordWrap },
      ],
      children: (
        <Toggle label={state.wordWrapLabel} pressed={state.wordWrap} onClick={state.onToggleWordWrap}>
          <WrapText size={14} />
        </Toggle>
      ),
    });
    // A reading aid, so it sits with wrap rather than with Save: it changes how
    // the document is SHOWN, and a narrow panel moves it into the `⋯` menu.
    clusters.push({
      id: 'blame',
      actions: [
        {
          label: state.blameInline ? 'Hide line blame' : 'Show line blame',
          icon: GitCommitVertical,
          onSelect: state.onToggleBlameInline,
          active: state.blameInline,
        },
      ],
      children: (
        <Toggle
          label={state.blameInline ? 'Hide line blame' : 'Show line blame'}
          pressed={state.blameInline}
          title="Who last changed each block, from git (hover a line for the commit)"
          onClick={state.onToggleBlameInline}
        >
          <GitCommitVertical size={14} />
        </Toggle>
      ),
    });
    clusters.push({
      id: 'zoom',
      actions: [
        { label: 'Decrease font size', icon: ZoomOut, onSelect: state.onZoomOut },
        { label: 'Increase font size', icon: ZoomIn, onSelect: state.onZoomIn },
      ],
      children: (
        <>
          <button
            type="button"
            onClick={state.onZoomOut}
            className={`${ACTION_CLASS} hover:bg-ink/5 hover:text-ink`}
            title="Decrease font size"
            aria-label="Decrease font size"
          >
            <ZoomOut size={14} />
          </button>
          <button
            type="button"
            onClick={state.onZoomIn}
            className={`${ACTION_CLASS} hover:bg-ink/5 hover:text-ink`}
            title="Increase font size"
            aria-label="Increase font size"
          >
            <ZoomIn size={14} />
          </button>
        </>
      ),
    });
    clusters.push({
      id: 'reload',
      // Never `pinned`: with a dirty buffer it is the one destructive control in
      // the row, and a menu is exactly the friction it should have.
      actions: [
        { label: 'Reload from disk', icon: RefreshCw, onSelect: state.onReload, disabled: !state.canReload },
      ],
      children: (
        <button
          type="button"
          onClick={state.onReload}
          disabled={!state.canReload || state.refreshing}
          aria-busy={state.refreshing}
          className={`${ACTION_CLASS} hover:bg-ink/5 hover:text-ink`}
          title={
            !state.canReload
              ? 'Nothing to reload — this tab has no file on disk'
              : state.reloadDiscardsEdits
                ? 'Discard my changes and reload from disk'
                : 'Reload from disk'
          }
          aria-label="Reload from disk"
        >
          <RefreshCw size={14} className={state.refreshing ? 'animate-spin' : undefined} />
        </button>
      ),
    });
  }

  clusters.push({
    id: 'copy',
    actions: [
      { label: state.copyLabel, icon: Copy, onSelect: state.onCopy },
      { label: 'Download file', icon: Download, onSelect: state.onDownload },
    ],
    children: (
      <>
        <button
          type="button"
          onClick={state.onCopy}
          className={`${ACTION_CLASS} hover:bg-ink/5 hover:text-ink`}
          title={state.copyLabel}
          aria-label={state.copyLabel}
        >
          {state.copied ? <Copy size={14} className="text-success" /> : <Copy size={14} />}
        </button>
        <button
          type="button"
          onClick={state.onDownload}
          className={`${ACTION_CLASS} hover:bg-ink/5 hover:text-ink`}
          title="Download file"
          aria-label="Download file"
        >
          <Download size={14} />
        </button>
      </>
    ),
  });

  // The width modes and full SCREEN are the controls this panel exists for, so they
  // are the LAST clusters — the tail is what the menu takes.
  clusters.push({
    id: 'view-modes',
    // The two width modes are why this toolbar grew these buttons, and a mode
    // reachable only from a menu is a mode half the readers never find.
    pinned: true,
    actions: state.viewModeActions,
    children: state.viewModeButtons,
  });
  clusters.push({
    id: 'maximize',
    pinned: true,
    actions: [
      {
        label: state.maximizeLabel,
        icon: state.isMaximized ? Minimize : Maximize,
        onSelect: state.onToggleMaximize,
        active: state.isMaximized,
      },
    ],
    children: state.maximizeButton,
  });

  return clusters;
}
