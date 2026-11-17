/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The panel switch a rail opens on right-click — or on a long press, on a
 * phone.
 *
 * The desktop rails and the phone drawers ask the same three questions: which
 * panels can this surface offer, which of them are switched off, and where does
 * the menu hang. Answering them in one hook is what keeps the phone's menu and
 * the desktop rail's menu from drifting: a panel hidden on one surface is the
 * same `disabledPanels` entry, and the list is the same `useAllPanelItems`
 * read, so a view cannot be switchable in one place and lost in the other.
 *
 * The surface handlers come from `useVisibilityMenuTrigger`, which owns the
 * long-press/right-click split; this hook only adds the panel data.
 */

import { useCallback } from 'preact/hooks';
import { useAllPanelItems } from '@/client/hooks/workspace/panel-menu-items';
import { usePanelPluginActions, usePanelRegistry } from '@/client/hooks/workspace/panel-registry';
import { useVisibilityMenuTrigger } from '@/client/hooks/ui/visibility-menu-trigger';
import type { PanelCatalogSide } from '@/client/components/workspace/plugin-panel/catalog';
import type { MenuAnchor, VisibilityItem } from '@/client/components/layout/VisibilityMenu';
import type { VisibilityMenuSurfaceProps } from '@/client/hooks/ui/visibility-menu-trigger';

export interface PanelVisibilityMenu {
  anchor: MenuAnchor | null;
  close: () => void;
  surfaceProps: VisibilityMenuSurfaceProps;
  items: VisibilityItem[];
  hidden: string[];
  toggle: (id: string, visible: boolean) => void;
}

export function usePanelVisibilityMenu(side: PanelCatalogSide): PanelVisibilityMenu {
  const { disabledPanels } = usePanelRegistry();
  const { setEnabled } = usePanelPluginActions();
  const visibility = useVisibilityMenuTrigger();
  const items = useAllPanelItems(side);
  const toggle = useCallback(
    (id: string, visible: boolean) => {
      void setEnabled(id, visible);
    },
    [setEnabled],
  );
  return { ...visibility, items, hidden: disabledPanels, toggle };
}
