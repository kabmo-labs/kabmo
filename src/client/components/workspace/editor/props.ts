/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor panel's prop contract.
 *
 * Split out of `index.tsx` for the repository's per-file ceiling, and it belongs here
 * for the same reason `code-surface/props.ts` does: the layout, the phone and every test
 * that mounts a panel name these, and importing a prop type from the component module
 * couples them to the mount.
 */

import type { OpenedFile } from '@/shared/types/fs';

export interface EditorProps {
  className?: string;
  openedFiles: OpenedFile[];
  /** Restore the most recently closed tab (the strip's menu and `⌘⇧T`). */
  onReopenClosed?: () => boolean;
  /** How many tabs can still be reopened. */
  reopenableCount?: () => number;
  /** Copy a tab's workspace-relative path. */
  onCopyPath?: (tab: OpenedFile) => void;
  /** Reveal a tab's file in the Files panel. */
  onRevealInFiles?: (tab: OpenedFile) => void;
  activeFileId: number | string | null;
  onSelectFile: (id: number | string) => void;
  onCloseFile: (id: number | string) => void;
  /** Replace a diff tab with the plain editor tab for the same file. */
  onConvertDiffToEditor: (id: number | string) => void;
  refreshKey?: number;
  onFileSaved?: () => void;
  /**
   * Open a workspace-relative path in a tab.
   *
   * The quick-open picker needs it: it answers paths, and `handleOpenFile` is the
   * one place a path becomes a tab (with the id scheme every other opener shares).
   */
  onOpenPath?: (path: string) => void;
  /** The workspace root and nested repo, so the file index is read from the right tree. */
  rootPath?: string | null;
  repoPath?: string | null;
  /**
   * A `plugin:<id>` key while a plugin owns the column, or null.
   *
   * There is no tab for it: the plugin takes the WHOLE surface, so the host has
   * no tab strip to draw and no file to show beside it. That is the difference
   * between a `panel` and an editor tab — the column is a place a view can live,
   * not a container the host fills with chrome.
   */
  activeEditorPanelKey?: string | null;
  /**
   * Render as a SPLIT PANE: draw the given tab, and draw no tab strip.
   *
   * The right pane is this same panel, so a split cannot have a feature the unsplit editor
   * lacks. It is told which tab to show rather than keeping its own `activeFileId`, because
   * the strip stays in the left pane and stays the single owner of the tab order.
   */
  forcedActiveFileId?: number | string | null;
  /** A split pane never splits again: the column has two panes, not a tree. */
  asSplitPane?: boolean;
}
