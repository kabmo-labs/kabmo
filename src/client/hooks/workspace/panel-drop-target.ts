/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A COLUMN BODY that accepts a panel dragged from either rail.
 *
 * The rails own the ORDER; a body only decides WHICH side receives a panel
 * dropped on it. That is the missing half of the gesture: with the left rail
 * off there is no rail strip to aim at, and dropping anywhere on the session
 * list must still put the panel on the dock. The right column body gets the
 * mirror rule, so a panel dragged across the window lands where it was dropped
 * instead of nowhere.
 *
 * Only a panel drag is claimed (`PANEL_DRAG_MIME`): a file or a URL dropped on a
 * view must keep bubbling to that view's own handlers.
 */

import { useCallback, useState } from 'preact/hooks';
import type { TargetedDragEvent } from 'preact';
import { carriesPanelDrag, droppedPanelId } from '@/shared/lib/workspace/panel-drag';

export interface PanelDropTargetOptions {
  /** Where a dropped panel goes — normally the placement store for that side. */
  onPlace: (panelId: string) => void;
  /**
   * Whether the body paints its own drop state. A body that sits BESIDE a rail
   * lets the rail draw it, so the same gesture does not ring two surfaces.
   */
  highlight?: boolean;
}

export interface PanelDropTarget {
  /** True while a panel hovers a highlighted body. */
  active: boolean;
  /** Spread on the body element. */
  dropProps: {
    onDragOver: (event: TargetedDragEvent<HTMLElement>) => void;
    onDragLeave: (event: TargetedDragEvent<HTMLElement>) => void;
    onDrop: (event: TargetedDragEvent<HTMLElement>) => void;
  };
}

export function usePanelDropTarget({ onPlace, highlight = true }: PanelDropTargetOptions): PanelDropTarget {
  const [active, setActive] = useState(false);

  const onDragOver = useCallback(
    (event: TargetedDragEvent<HTMLElement>) => {
      if (!event.dataTransfer || !carriesPanelDrag(event.dataTransfer.types)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (highlight && !active) setActive(true);
    },
    [highlight, active],
  );

  const onDragLeave = useCallback((event: TargetedDragEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    setActive(false);
  }, []);

  const onDrop = useCallback(
    (event: TargetedDragEvent<HTMLElement>) => {
      if (!event.dataTransfer) return;
      const id = droppedPanelId(event.dataTransfer);
      if (!id) return;
      event.preventDefault();
      setActive(false);
      onPlace(id);
    },
    [onPlace],
  );

  return { active, dropProps: { onDragOver, onDragLeave, onDrop } };
}
