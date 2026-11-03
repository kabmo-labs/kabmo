/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The phone drawer's folder `⋯`: the trigger and its menu, in one module.
 *
 * Split out of the drawer row because the panel is PORTALLED (see
 * `common/anchored-menu/`): the drawer list is a scroller, and the panel it used
 * to hang inside was clipped at the scroller's edge and lost to the sticky
 * workspace headers once the list scrolled — measured with `elementFromPoint`.
 * Keeping the trigger and the panel together means the anchor is captured where
 * the click happens and the drawer row holds no menu state of its own.
 *
 * Every action closes the menu before it runs: Pin and Delete paint a toast, and
 * a menu left standing over it hides the answer to the click.
 */

import { useRef, useState } from 'preact/hooks';
import { MoreHorizontal } from 'lucide-preact';
import { AnchoredMenu } from '@/client/components/common/anchored-menu';
import { anchorRectOf, type AnchorRect } from '@/shared/lib/ui/menu-anchor';
import { WorkspaceOptionsMenu } from '@/client/components/common/workspace-options-menu';
import type { WorkspaceFolderData } from '@/shared/types';

export interface FolderItemMenuProps {
  folder: WorkspaceFolderData;
  /** True when this folder is bound to a repository the menu may branch from. */
  canWorktree: boolean;
  onOpenFolder?: () => void;
  onNewWorktree?: () => void;
  onSelectSessions?: () => void;
  confirmDelete: boolean;
  onPin: () => void;
  onDelete: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
}

/** The row's trailing control box, matched to its `＋` beside it. */
const TRIGGER_CLASS =
  'p-1.5 rounded-lg hover:bg-ink/10 active:bg-ink/15 text-ink/60 hover:text-ink';

export function FolderItemMenu({
  folder,
  canWorktree,
  onOpenFolder,
  onNewWorktree,
  onSelectSessions,
  confirmDelete,
  onPin,
  onDelete,
  onRequestDelete,
  onCancelDelete,
}: FolderItemMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);

  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div className="relative flex items-center" onClick={(event) => event.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          if (triggerRef.current) setAnchor(anchorRectOf(triggerRef.current));
          setOpen((was) => !was);
        }}
        className={TRIGGER_CLASS}
        title="Workspace options"
        aria-label={`Options for ${folder.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal size={15} />
      </button>

      <AnchoredMenu
        anchor={open ? anchor : null}
        align="end"
        ariaLabel={`Options for ${folder.name}`}
        className="w-48 rounded-lg border border-ink/15 bg-paper py-1 text-xs shadow-lg"
        onClose={() => {
          setOpen(false);
          onCancelDelete();
        }}
      >
        <WorkspaceOptionsMenu
          variant="mobile"
          isPinned={folder.isPinned}
          onOpenFolder={onOpenFolder ? run(onOpenFolder) : undefined}
          onNewWorktree={canWorktree && onNewWorktree ? run(onNewWorktree) : undefined}
          onSelectSessions={onSelectSessions ? run(onSelectSessions) : undefined}
          confirmDelete={confirmDelete}
          onPin={run(onPin)}
          onDelete={run(onDelete)}
          onRequestDelete={onRequestDelete}
          onCancelDelete={onCancelDelete}
        />
      </AnchoredMenu>
    </div>
  );
}
