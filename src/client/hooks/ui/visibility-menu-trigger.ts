/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The right-click menu, for a surface a finger has to reach.
 *
 * The desktop rails and navbar open their visibility menu on `contextmenu`.
 * A phone has no right button, so the same menu was unreachable there: the
 * phone's header, session drawer and right drawer drew the controls but had no
 * way to switch one off. A long press is the phone's right-click, and this hook
 * is the one place that turns it into the same `MenuAnchor` the desktop
 * handlers produce.
 *
 * Three rules, each a way the gesture would otherwise misbehave:
 *
 * - **A press that MOVES is a scroll.** `useLongPress` owns that rule; this
 *   hook only decides what a completed press opens.
 * - **The click the same gesture produces is swallowed.** Lifting the finger
 *   after the menu opened would otherwise also press the control underneath
 *   (close the drawer, switch a panel). The capture handler consumes it before
 *   the control's own `onClick` runs.
 * - **A mouse still gets its right button.** `contextmenu` is handled on every
 *   device, so a desktop showing the phone layout keeps the menu it had.
 *
 * The anchor is the surface's own rectangle for a right-click (the menu hangs
 * off the rail, not off the pixel) and the press point for a long press (there
 * is no cursor to anchor to).
 */

import { useCallback, useState } from 'preact/hooks';
import type { TargetedMouseEvent } from 'preact';
import { useLongPress } from '@/client/hooks/ui/long-press';
import { useTouchDevice } from '@/client/hooks/ui/touch-device';
import type { MenuAnchor } from '@/client/components/layout/VisibilityMenu';

/** The handlers a surface spreads onto the element that owns the menu. */
export interface VisibilityMenuSurfaceProps {
  onContextMenu: (event: TargetedMouseEvent<HTMLElement>) => void;
  onTouchStart: (event: globalThis.TouchEvent) => void;
  onTouchMove: (event: globalThis.TouchEvent) => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
  onClickCapture: (event: TargetedMouseEvent<HTMLElement>) => void;
}

export interface VisibilityMenuTrigger {
  /** Non-null while the menu is open. */
  anchor: MenuAnchor | null;
  close: () => void;
  surfaceProps: VisibilityMenuSurfaceProps;
}

export function useVisibilityMenuTrigger(): VisibilityMenuTrigger {
  const touch = useTouchDevice();
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);

  const openAt = useCallback((x: number, y: number) => {
    setAnchor({ top: y, bottom: y, left: x, right: x });
  }, []);
  const longPress = useLongPress({ enabled: touch, onLongPress: openAt });
  const close = useCallback(() => setAnchor(null), []);

  return {
    anchor,
    close,
    surfaceProps: {
      onContextMenu: (event) => {
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        setAnchor({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right });
      },
      onTouchStart: longPress.onTouchStart,
      onTouchMove: longPress.onTouchMove,
      onTouchEnd: longPress.onTouchEnd,
      onTouchCancel: longPress.onTouchCancel,
      onClickCapture: (event) => {
        if (!longPress.consume()) return;
        event.preventDefault();
        event.stopPropagation();
      },
    },
  };
}
