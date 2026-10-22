/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The desktop half of `omp:open-panel`: turn a panel key into a visible column.
 *
 * The COLUMN is the user's placement, read from the dock state, never a choice
 * the caller makes: the same panel may sit on the left dock, in the right
 * column or in the editor column, and a plugin that named one would break the
 * moment the user moved it. Each handler therefore does what the rail's own
 * button does — select the view AND open its column — because a selection made
 * while the column is collapsed is a click that changed nothing on screen.
 *
 * The phone does not use this: its drawers are SCREENS, and which one can reach
 * a panel is a different question (`phoneDrawerForPanel`).
 */

import { useKabmoEvent } from '@/client/hooks/ui/window-event';
import type { LeftDockState } from '@/shared/lib/workspace/left-dock';
import { panelSideOf } from '@/shared/lib/workspace/left-dock';
import { OPEN_PANEL_EVENT, type OpenPanelDetail } from '@/shared/lib/workspace/panel-open';

export interface OpenPanelTargets {
  /** The dock state the placement is read from. */
  dock: LeftDockState;
  onLeft: (panelKey: string) => void;
  onEditor: (panelKey: string) => void;
  onRight: (panelKey: string) => void;
}

export function useOpenPanelRequest(targets: OpenPanelTargets): void {
  useKabmoEvent(OPEN_PANEL_EVENT, (event) => {
    const panelKey = (event as CustomEvent<OpenPanelDetail>).detail?.panelKey;
    if (!panelKey) return;
    const side = panelSideOf(panelKey, targets.dock);
    if (side === 'left') targets.onLeft(panelKey);
    else if (side === 'editor') targets.onEditor(panelKey);
    else targets.onRight(panelKey);
  });
}
