/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One overflow menu for a session row, shared by the desktop sidebar and the
 * mobile one.
 *
 * The row used to carry its actions as side-by-side hover icons (rename,
 * archive, delete). That does not scale: three icons cost roughly a third of
 * the title's width in the 268px sidebar, and every action added from here
 * takes another slice. One trigger whose contents grow is the shape that
 * survives the next action.
 *
 * Two ways in, one menu out:
 *   - the `⋯` button, which is the discoverable affordance;
 *   - a right-click anywhere on the row, which is the accelerator. Both are
 *     wired by the row component through `useRowMenu`.
 *
 * The menu positions itself from its OWN measured size. The item list is
 * conditional (a pending `new-…` chat has no Rename or Delete), so a constant
 * height would put the last row off-screen at the viewport edge — the same
 * class of bug the file explorer's context menu works around with hand-tuned
 * numbers.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { TargetedMouseEvent } from 'preact';
import { createPortal } from 'preact/compat';
import { placeMenu, type MenuPlacement } from '@/shared/lib/ui/menu-anchor';
import { Archive, ArchiveRestore, Copy, Download, GitBranch, GitFork, Hourglass, Pencil, Trash2, WandSparkles } from 'lucide-preact';
import { useSearchParams } from '@/client/lib/router/search-params';
import { clearBranchParams } from '@/client/lib/router/branch-params';
import { startPendingSession } from '@/client/hooks/chat/omp/pending-sessions';
import { expandSessionBranch } from '@/client/hooks/workspace/expanded-sessions';
import { setHarnessPick } from '@/client/hooks/chat/timeline/session-harness';
import { formatNewSessionTitle } from '@kabmo-labs/kabmo-omp/session-core/default-title';
import { canForkChat } from '@kabmo-labs/kabmo-harness/rewind/fork';
import { openForkSession } from '@/client/hooks/chat/timeline/fork-open';
import { useHarnesses } from '@/client/hooks/models/use-harnesses';
import { copyToClipboard } from '@/client/hooks/ui/clipboard';
import { exportSessionMarkdown } from '@/client/lib/session-export';
import { useToasts } from '@/client/hooks/ui/toasts';
import { MenuItem } from '@/client/components/common/session-actions-menu/MenuItem';

/** Viewport coordinates the menu hangs off, plus which edge it aligns to. */
export interface MenuAnchor {
  top: number;
  right: number;
  bottom: number;
  left: number;
  /**
   * `end` hangs the menu's right edge off the anchor's — what a row's overflow
   * button expects, since it sits at the row's end. `start` puts the menu's
   * left edge at the anchor's, so a context-menu click opens away from the
   * pointer rather than under it.
   */
  align: 'start' | 'end';
}

export interface RowMenuHandle {
  /** Non-null while the menu is open. */
  anchor: MenuAnchor | null;
  /** Open below the clicked element (the `⋯` button). */
  openBelow: (event: TargetedMouseEvent<HTMLElement>) => void;
  /** Open at the pointer (a right-click on the row). */
  openAtCursor: (event: TargetedMouseEvent<HTMLElement>) => void;
  close: () => void;
}

/** Anchor state for one row's overflow menu. */
export function useRowMenu(): RowMenuHandle {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);

  const openBelow = useCallback((event: TargetedMouseEvent<HTMLElement>) => {
    event.preventDefault();
    // The row underneath selects the session on click; opening its menu is not
    // a selection.
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setAnchor({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, align: 'end' });
  }, []);

  const openAtCursor = useCallback((event: TargetedMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const { clientX, clientY } = event;
    setAnchor({ top: clientY, right: clientX, bottom: clientY, left: clientX, align: 'start' });
  }, []);

  const close = useCallback(() => setAnchor(null), []);

  return { anchor, openBelow, openAtCursor, close };
}

export interface SessionActionsMenuProps {
  anchor: MenuAnchor;
  /** The row's id; enables "New child session". Absent on a synthetic row. */
  sessionId?: string | number;
  /** The row's harness, so the child dialog starts on the agent that ran it. */
  harness?: string;
  /** The row's folder, so a pending child lands in the right workspace. */
  folderId?: number | string;
  isArchived?: boolean;
  /** Omitted when the row cannot be renamed (a pending `new-…` chat). */
  onRename?: () => void;
  /** Ask omp to name the session from its transcript. Omitted for a pending
   *  `new-…` chat, which has no transcript to derive a title from. */
  onRenameWithAi?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
  /**
   * Drop this row's held prompt (a `new-…` chat whose prompt is waiting on
   * another session). Omitted for every other row: a wait is the only state a
   * pending chat can cancel from here, and offering the item elsewhere would
   * promise an action with nothing behind it.
   */
  onCancelWait?: () => void;
  onClose: () => void;
}

export function SessionActionsMenu({
  anchor,
  sessionId,
  harness,
  folderId,
  isArchived = false,
  onRename,
  onRenameWithAi,
  onArchive,
  onDelete,
  onCancelWait,
  onClose,
}: SessionActionsMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<MenuPlacement | null>(null);
  const [, setSearchParams] = useSearchParams();
  const { harnesses } = useHarnesses();
  const { pushToast } = useToasts();
  const canSpawnChild =
    sessionId !== undefined &&
    !String(sessionId).startsWith('new-') &&
    !isArchived;
  // A pending `new-…` row has no omp id yet: copying it would hand the user a
  // string that stops existing the moment the chat spawns.
  const canCopyId = sessionId !== undefined && !String(sessionId).startsWith('new-');
  // A pending `new-…` row has no transcript on disk, so there is nothing to
  // export yet — the same reason it has no id to copy.
  const canExport = canCopyId;
  // The probe is authoritative when it has an answer; without one the
  // harness's expected capability decides. A harness that cannot fork at all
  // (qwen, dsh, antigravity, pi, command-code) gets no item.
  const probeFork = harnesses.find((entry) => entry.id === harness)?.probe?.capabilities.forkSession;
  const canForkChatHere =
    sessionId !== undefined &&
    !String(sessionId).startsWith('new-') &&
    !isArchived &&
    canForkChat(harness, probeFork);

  /**
   * "New child session" opens the SAME pending-chat composer as New Session,
   * with the parent recorded on the row. A modal would have hid the workspace,
   * worktree and parent pickers the composer already owns.
   */
  const startChildSession = () => {
    if (sessionId === undefined) return;
    const parentId = String(sessionId);
    const pendingId = startPendingSession(folderId ?? null, {
      parentSessionId: parentId,
      ...(harness ? { harness } : {}),
      title: formatNewSessionTitle(new Date(), 'New Child'),
    });
    // The picker's first tab is the parent's agent, not omp's default.
    if (harness) setHarnessPick(pendingId, harness);
    expandSessionBranch(parentId);
    setSearchParams((prev) => {
      // A fork the user backed out of leaves `forkFrom`/`forkAt` in the URL, and
      // this chat would otherwise be read as that fork (the fork check runs
      // before the child one). Start from a branchless query and set only the
      // parent this child really has.
      const next = clearBranchParams(prev);
      next.set('sessionId', pendingId);
      next.set('parentSessionId', parentId);
      if (folderId !== undefined) next.set('folderId', String(folderId));
      return next;
    }, { replace: true });
  };

  /**
   * "Fork chat" opens the same pending composer as the per-message Fork, with
   * no anchor: the branch copies the whole conversation. It is the only fork
   * entry point for a harness whose agent takes no fork point (zcode, opencode,
   * minimax) — the per-row button is reserved for message-level forks.
   */
  const startForkChat = () => {
    if (sessionId === undefined) return;
    const numericFolderId = folderId === undefined ? null : Number(folderId);
    openForkSession({
      sourceSessionId: String(sessionId),
      ...(harness ? { harness } : {}),
      folderId: numericFolderId !== null && Number.isFinite(numericFolderId) ? numericFolderId : null,
      anchorEntryId: null,
      setSearchParams,
    });
  };

  /**
   * "Copy session ID" puts the row's omp id on the clipboard so it can be
   * pasted into the sidebar search (which matches ids as well as titles) or
   * into a bug report. The toast is the only feedback: the menu closes on the
   * click, exactly like every other item.
   */
  const copySessionId = () => {
    if (sessionId === undefined) return;
    void copyToClipboard(String(sessionId)).then((ok) => {
      pushToast(
        ok ? 'Session ID copied' : 'Could not copy session ID',
        ok ? 'success' : 'error',
      );
    });
  };

  /**
   * "Export markdown" writes the whole transcript to a `.md` file. The menu
   * closes on the click, so the toast is the only feedback — and a refusal
   * (no transcript, a failed read) is reported in words rather than leaving
   * the user with a download that never happened.
   */
  const exportMarkdown = () => {
    if (sessionId === undefined) return;
    void exportSessionMarkdown(String(sessionId)).then((result) => {
      pushToast(
        result.ok ? `Exported ${result.name}` : result.error,
        result.ok ? 'success' : 'error',
      );
    });
  };

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    // The same arithmetic as every other anchored panel (`menu-anchor`): below
    // the trigger, scrollable when it does not fit, and above only when the
    // trigger sits too close to the bottom edge. A phone's drawer puts the row's
    // `⋯` near the bottom, so this menu used to open above the button pressed.
    const next = placeMenu(
      anchor,
      { width: box.width, height: box.height },
      { width: window.innerWidth, height: window.innerHeight },
      anchor.align,
    );
    setPos((prev) =>
      prev && prev.top === next.top && prev.left === next.left && prev.maxHeight === next.maxHeight ? prev : next,
    );
  });

  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Every item closes the menu first: Rename opens an inline editor in the row,
  // and leaving the menu over it would cover the input.
  const run = (action?: () => void) => () => {
    onClose();
    action?.();
  };

  return createPortal(
    <>
    <div
      className="fixed inset-0 z-[70]"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        ref={menuRef}
        role="menu"
        aria-label="Session actions"
        style={{
          top: pos?.top ?? anchor.bottom + 4,
          left: pos?.left ?? anchor.left,
          ...(pos ? { maxHeight: `${pos.maxHeight}px` } : {}),
          // Hidden for the single pre-measure render; `useLayoutEffect` settles
          // the position before the browser paints, so this never flashes.
          visibility: pos ? 'visible' : 'hidden',
        }}
        className="glass-popover fixed z-[70] w-44 overflow-y-auto overscroll-contain bg-paper border border-ink/15 rounded-lg shadow-xl py-1 text-xs text-ink font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        {canSpawnChild && (
          <MenuItem icon={GitBranch} label="New child session" onClick={run(startChildSession)} />
        )}
        {canForkChatHere && (
          <MenuItem icon={GitFork} label="Fork chat" onClick={run(startForkChat)} />
        )}
        {onRename && <MenuItem icon={Pencil} label="Rename" onClick={run(onRename)} />}
        {/* Next to Rename because it is the same intent, done for you: omp
            reads the transcript and names the session itself. It replaces an
            existing name, which is why it is an explicit click and never
            something that happens on its own. */}
        {onRenameWithAi && (
          <MenuItem icon={WandSparkles} label="Rename with AI" onClick={run(onRenameWithAi)} />
        )}
        {/* The id is the one handle that survives a rename, and the sidebar
            search matches it — so it belongs beside the naming verbs. */}
        {canCopyId && (
          <MenuItem icon={Copy} label="Copy session ID" onClick={run(copySessionId)} />
        )}
        {canExport && (
          <MenuItem icon={Download} label="Export markdown" onClick={run(exportMarkdown)} />
        )}
        {/* A held prompt is the row's whole content, so dropping it belongs in
            the same menu as the row's other verbs rather than on the row face. */}
        {onCancelWait && (
          <MenuItem icon={Hourglass} label="Cancel waiting prompt" onClick={run(onCancelWait)} />
        )}
        {onArchive && (
          <MenuItem
            icon={isArchived ? ArchiveRestore : Archive}
            label={isArchived ? 'Unarchive' : 'Archive'}
            onClick={run(onArchive)}
          />
        )}
        {(onRename || onRenameWithAi || onArchive || onCancelWait) && onDelete && <div className="my-1 border-t border-ink/10" />}
        {onDelete && <MenuItem icon={Trash2} label="Delete" onClick={run(onDelete)} danger />}
      </div>
    </div>
    </>,
    document.body,
  );
}
