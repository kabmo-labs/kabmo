/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The ONE data contract both sidebar styles render.
 *
 * The style setting exists so the list can be drawn two ways, not so it can
 * behave two ways: a folder, a row, a rename, a delete, a worktree chat and a
 * batch selection must all be reachable from either style, with the same
 * confirmations and the same server calls. That is guaranteed structurally —
 * `SessionsView` owns the controller, the dialogs and every mutation, and a
 * style variant receives this object and nothing else. A variant that wants a
 * new field is a variant asking to become a second sidebar; the answer is to
 * add the field here, so the other style gets it too.
 *
 * Deliberately a type-only module: it is imported by both styles and by the
 * dispatcher, and it must not pull a component into any of them.
 */

import type { SessionSortOption, WorkspaceFolderData } from '@/shared/types';
import type { BatchBinding } from '@/client/components/common/batch-selection/types';

export type SessionStatusMap = Record<string, 'stream' | 'finish' | 'abort'>;

export interface SessionSidebarVariantProps {
  className?: string;
  /** The folders the list renders — already sorted and search-filtered. */
  folders: WorkspaceFolderData[];
  /** True until the first list fetch settles (drives the skeleton). */
  initializing: boolean;
  activeSessionId: number | string | null;
  sessionStatus: SessionStatusMap;

  searchQuery: string;
  onSearchChange: (value: string) => void;
  showArchived: boolean;
  /** Flip the archive filter. Both chromes read it as a toggle. */
  onToggleArchived: () => void;

  sortOption: SessionSortOption;
  optionsOpen: boolean;
  onToggleOptions: () => void;
  onCloseOptions: () => void;
  onSortChange: (option: SessionSortOption) => void;

  /** Reload the list; `refreshing` spins whatever the style's refresh control is. */
  onRefresh: () => void;
  refreshing: boolean;
  /** Armed scheduled tasks, for the calendar badge. */
  scheduledCount: number;

  /** The toolbar's primary action, in both styles and on both layouts. */
  onNewSession: () => void;
  onNewWorkspace: () => void;
  onScheduler: () => void;

  onSelectSession: (id: number | string) => void;
  onNewSessionForFolder: (folderId: number) => void;
  /** Start a chat in a worktree made from this folder. */
  onNewWorktreeSession?: (folderId: number, worktreePath: string) => void;
  /** Reports a refused folder action (the reveal endpoint's own reason). */
  onToast: (message: string, type?: 'success' | 'error') => void;
  onCancelWait?: (waitId: string) => void;

  /** The active batch mode, or undefined when the list is not selecting. */
  batch?: BatchBinding;
  /** Enter workspace selection from the style's own control. */
  onSelectWorkspaces: () => void;
  /** Start a session selection scoped to a workspace, from its `⋯` menu. */
  onStartSessionSelection: (folderId: number) => void;
}
