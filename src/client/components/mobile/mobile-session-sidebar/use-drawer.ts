/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The phone drawer's state, gathered in one hook so the component stays under
 * the repo's per-file ceiling.
 *
 * Everything here is the drawer's own wiring, not a second implementation of
 * anything: the controller, the folder-expansion seed, the batch machine and
 * the dock are the same hooks the desktop column uses. The split is by
 * responsibility — this file answers "what does the drawer know", the component
 * answers "what does it draw" — and it is the seam that lets the drawer hand the
 * SAME `SessionSidebarVariantProps` to either chrome.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';
import { useSessionSidebarController } from '@/client/hooks/chat/omp/session-sidebar-controller';
import { useSidebarBatch } from '@/client/hooks/workspace/sidebar-batch';
import { setFolderExpanded } from '@/client/hooks/workspace/folder-expansion';
import { dockBodyProps, useMobileDock } from '@/client/components/mobile/mobile-session-sidebar/use-dock';
import type { SessionSidebarController } from '@/client/hooks/chat/omp/session-sidebar-controller';
import type { SidebarBatch } from '@/client/hooks/workspace/sidebar-batch';

export interface DrawerState {
  controller: SessionSidebarController;
  batch: SidebarBatch;
  /** Folder expansion, seeded from the list the drawer actually renders. */
  expandedFolders: Record<number, boolean>;
  toggleFolder: (folderId: number) => void;
  optionsRef: { current: HTMLDivElement | null };
  dock: ReturnType<typeof useMobileDock>;
  dockBody: ReturnType<typeof dockBodyProps>;
}

export interface DrawerOptions {
  appSettings: Record<string, any>;
  onSelectSession: (id: number | string) => void;
  onClose: () => void;
  rootPath?: string;
  refreshKey: number;
  onRefresh?: () => void;
  onOpenFile?: (file: unknown) => void;
}

export function useDrawerState({
  appSettings,
  onSelectSession,
  onClose,
  rootPath,
  refreshKey,
  onRefresh,
  onOpenFile,
}: DrawerOptions): DrawerState {
  const controller = useSessionSidebarController(appSettings, { onSelectSession, onAfterSelect: onClose });
  const { folders, processedFolders, refreshNow, showArchived, activeSessionId } = controller;
  const batch = useSidebarBatch(processedFolders, showArchived, refreshNow);

  const [expandedFolders, setExpandedFolders] = useState<Record<number, boolean>>({
    1: true,
    2: true,
    3: true,
  });

  const optionsRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(optionsRef, () => controller.setOptionsOpen(false));

  const toggleFolder = (folderId: number) => {
    setExpandedFolders(prev => ({ ...prev, [folderId]: !prev[folderId] }));
    const folder = folders.find(item => item.id === folderId);
    const nextExpanded = !(expandedFolders[folderId] ?? folder?.isExpanded ?? true);
    void setFolderExpanded(folderId, nextExpanded);
  };

  // Seeded from the list the drawer RENDERS, not from the raw server payload:
  // the controller force-opens a folder that hosts a pending row (a chat whose
  // transcript omp has not written yet), and a seed taken from the raw folders
  // would collapse it again — hiding the one row the user cannot get back by
  // expanding, because nothing else knows it exists.
  //
  // Keyed on the flags themselves rather than the array: `processedFolders` is
  // a new array on every sidebar push (a tool call republishes the structure),
  // and re-seeding on identity would discard every expansion the user just
  // made, several times a minute.
  const expansionSeed = processedFolders.map(folder => `${folder.id}:${folder.isExpanded}`).join('|');
  useEffect(() => {
    setExpandedFolders(Object.fromEntries(processedFolders.map(folder => [folder.id, folder.isExpanded])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expansionSeed]);

  const dock = useMobileDock();
  const dockBody = dockBodyProps({
    sessionId: activeSessionId,
    refreshKey,
    rootPath,
    onRefresh,
    onOpenFile,
    onClose,
  });

  return { controller, batch, expandedFolders, toggleFolder, optionsRef, dock, dockBody };
}
