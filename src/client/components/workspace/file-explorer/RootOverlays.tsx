/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Files panel's ROOT-level overlays: the background's context menu and the
 * New File / New Folder dialog it opens.
 *
 * Split out of `index.tsx` because the panel owns far too much state to also
 * keep this markup inline, and because both pieces are pure projection of the
 * root menu's state and the `useFileCreate` handle — no behaviour lives here.
 */

import type { RefObject } from 'preact/compat';
import { RootContextMenu } from '@/client/components/workspace/file-explorer/RootMenu';
import { FileCreateModal } from '@/client/components/workspace/file-explorer/Modals';
import type { FileCreate } from '@/client/hooks/workspace/file-create';

export interface RootOverlaysProps {
  menu: { x: number; y: number } | null;
  menuRef: RefObject<HTMLDivElement>;
  /** The clipboard label the root's Paste row shows, or null when it cannot land. */
  pasteLabel: string | null;
  busy: boolean;
  /** A root menu action id; the panel closes the menu and dispatches. */
  onAction: (action: string) => void;
  /** The root's own create flow. */
  create: FileCreate;
}

export function RootOverlays({ menu, menuRef, pasteLabel, busy, onAction, create }: RootOverlaysProps) {
  return (
    <>
      {menu && (
        <RootContextMenu
          x={menu.x}
          y={menu.y}
          menuRef={menuRef}
          pasteLabel={pasteLabel}
          busy={busy}
          onAction={onAction}
        />
      )}

      {create.open && (
        <FileCreateModal
          folderPath="."
          kind={create.kind}
          value={create.name}
          error={create.error}
          isLoading={create.busy}
          onChange={create.setName}
          onCancel={create.closeDialog}
          onSubmit={create.submit}
        />
      )}
    </>
  );
}
