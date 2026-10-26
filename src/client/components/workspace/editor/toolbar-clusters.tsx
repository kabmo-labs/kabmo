/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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
 * **Revert is deliberately never pinned.** It is the only destructive control in
 * the row, and a `⋯` menu is exactly the friction a destructive action should have.
 */

import type { ComponentChildren } from 'preact';
import {
  Copy,
  Download,
  Eye,
  EyeOff,
  Maximize,
  Minimize,
  RotateCcw,
  Save,
  Search,
  WrapText,
  ZoomIn,
  ZoomOut,
} from 'lucide-preact';

import type { ToolbarCluster } from '@/client/components/common/toolbar-row';

/** Shared icon-button shell. Every action here is icon-only, so each carries both names. */
export const ACTION_CLASS =
  'flex items-center justify-center p-1.5 rounded transition-colors cursor-pointer disabled:cursor-default disabled:opacity-50';

/** The state the toolbar draws, already resolved by the caller. */
export interface ToolbarState {
  byteViewer: boolean;
  hasPreview: boolean;
  isPreview: boolean;
  wordWrap: boolean;
  findOpen: boolean;
  copied: boolean;
  isMaximized: boolean;
  saveDisabled: boolean;
  canRevert: boolean;
  saveButton: ComponentChildren;
  previewLabel: string;
  findLabel: string;
  wordWrapLabel: string;
  copyLabel: string;
  maximizeLabel: string;
  onTogglePreview: () => void;
  onToggleFind: () => void;
  onToggleWordWrap: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onRevert: () => void;
  onToggleMaximize: () => void;
  onSave: () => void;
  viewModeActions: ToolbarCluster['actions'];
  maximizeButton: ComponentChildren;
  viewModeButtons: ComponentChildren;
}

/** One pressed-state toggle. */
function Toggle({
  label,
  pressed,
  title,
  onClick,
  children,
}: {
  label: string;
  pressed: boolean;
  title?: string;
  onClick: () => void;
  children: ComponentChildren;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${ACTION_CLASS} hover:bg-ink/5 ${pressed ? 'text-ink' : 'hover:text-ink'}`}
      title={title ?? label}
      aria-label={label}
      aria-pressed={pressed}
    >
      {children}
    </button>
  );
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

  if (!state.byteViewer) {
    clusters.push({
      id: 'save',
      // The primary action of the panel: a menu row must never be the only way to
      // save a file.
      pinned: true,
      actions: [{ label: 'Save file', icon: Save, onSelect: state.onSave, disabled: state.saveDisabled }],
      children: state.saveButton,
    });
  }

  if (state.hasPreview) {
    clusters.push({
      id: 'preview',
      actions: [
        {
          label: state.previewLabel,
          icon: state.isPreview ? EyeOff : Eye,
          onSelect: state.onTogglePreview,
          active: state.isPreview,
        },
      ],
      children: (
        <Toggle label={state.previewLabel} pressed={state.isPreview} onClick={state.onTogglePreview}>
          {state.isPreview ? <EyeOff size={14} /> : <Eye size={14} />}
        </Toggle>
      ),
    });
  }

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
      id: 'revert',
      // Never `pinned`: it is the one destructive control in the row, and a menu is
      // exactly the friction it should have.
      actions: [
        { label: 'Revert file', icon: RotateCcw, onSelect: state.onRevert, disabled: !state.canRevert },
      ],
      children: (
        <button
          type="button"
          onClick={state.onRevert}
          disabled={!state.canRevert}
          className={`${ACTION_CLASS} hover:bg-ink/5 hover:text-ink`}
          title={state.canRevert ? 'Discard my changes and reload from disk' : 'No unsaved changes to discard'}
          aria-label="Revert file"
        >
          <RotateCcw size={14} />
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
