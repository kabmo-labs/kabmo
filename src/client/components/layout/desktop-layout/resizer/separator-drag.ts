import { useEffect, useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact';
import type { TargetedPointerEvent } from 'preact';
import { clamp, transfer } from '@/client/components/layout/desktop-layout/resizer/utils';
import { RESIZE_FOLLOW_INTERVAL_MS } from '@/shared/lib/workspace/panel-widths';
import type { GroupOrientation, LayoutChangedHandler, PanelState } from '@/client/components/layout/desktop-layout/resizer';

export interface SeparatorDrag {
  /** A drag is in flight; the caller renders the pointer-capture blocker. */
  dragging: boolean;
  /** Pointer position of the guide line, or null when not dragging. */
  guidePx: number | null;
  onPointerDown: (event: TargetedPointerEvent<HTMLDivElement>) => void;
}

/**
 * The deferred drag behind a separator.
 *
 * A ghost guide line follows the pointer, and the real width is re-applied at
 * most every `RESIZE_FOLLOW_INTERVAL_MS`. Applying it on every pointermove
 * re-renders both panels per frame and reflows whatever they contain — a
 * terminal buffer, a CodeMirror document, a browser iframe — for a width the
 * user is still choosing. The panel's own width transition smooths the steps that land.
 *
 * Kept out of `index.tsx` so the components stay inside the repo's file-size
 * ceiling.
 */
export function useSeparatorDrag(
  hostRef: RefObject<HTMLDivElement | null>,
  orientation: GroupOrientation,
  panels: { current: Map<string, PanelState> },
  onLayoutChanged: { current: LayoutChangedHandler | null },
): SeparatorDrag {
  const [dragging, setDragging] = useState(false);
  // State, not a ref: the guide line has to move with the pointer even though
  // the panels deliberately do not.
  const [guidePx, setGuidePx] = useState<number | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // A drag owns two window listeners; if the separator unmounts mid-drag (a
  // layout switch) nothing else would ever remove them.
  useEffect(() => () => cleanupRef.current?.(), []);

  const onPointerDown = (e: TargetedPointerEvent<HTMLDivElement>) => {
    const host = hostRef.current;
    if (!host || e.button !== 0) return;
    // Walk past separators and collapsed panels to the real neighbours. A
    // collapsed panel keeps its DOM node (so its state survives and the width
    // transition has something to animate), but it is zero-width and its own
    // floor still reads as 320 in the registry — pairing a drag against it
    // would clamp every delta to zero and kill the separator.
    const neighbour = (start: Element | null, step: 'previous' | 'next') => {
      let node = start;
      while (node) {
        if (node.hasAttribute('data-separator') || node.hasAttribute('data-panel-collapsed')) {
          node = step === 'previous' ? node.previousElementSibling : node.nextElementSibling;
          continue;
        }
        return node instanceof HTMLElement && node.hasAttribute('data-panel') ? node : null;
      }
      return null;
    };

    const previous = neighbour(host.previousElementSibling, 'previous');
    const next = neighbour(host.nextElementSibling, 'next');
    const a = previous ? panels.current.get(previous.getAttribute('data-panel-id') ?? '') : undefined;
    const b = next ? panels.current.get(next.getAttribute('data-panel-id') ?? '') : undefined;
    if (!a || !b || !previous || !next) return;

    e.preventDefault();
    setDragging(true);

    const horizontal = orientation === 'horizontal';
    const startPos = horizontal ? e.clientX : e.clientY;
    const measure = (el: HTMLElement) =>
      horizontal ? el.getBoundingClientRect().width : el.getBoundingClientRect().height;
    // Measure, never ask the panel: a window narrow enough for flexbox to
    // shrink a panel below its specified width would otherwise start the drag
    // from a size the panel does not have on screen.
    const aStart = measure(previous);
    const bStart = measure(next);

    // The size the throttle last committed, kept apart from the guide line so
    // every step that lands is a legal clamped size.
    let pending: { a: number; b: number } | null = null;
    let followTimer: ReturnType<typeof setTimeout> | undefined;

    const apply = (sizes: { a: number; b: number }) => {
      a.setSize(sizes.a);
      if (!b.isFiller) b.setSize(sizes.b);
    };

    const onMove = (ev: PointerEvent) => {
      const pos = horizontal ? ev.clientX : ev.clientY;
      const delta = transfer(
        { size: aStart, min: a.minSize, max: a.maxSize },
        { size: bStart, min: b.minSize, max: b.maxSize },
        pos - startPos,
      );
      pending = {
        a: clamp(aStart + delta, a.minSize, a.maxSize),
        b: clamp(bStart - delta, b.minSize, b.maxSize),
      };
      setGuidePx(pos);
      if (followTimer === undefined) {
        followTimer = setTimeout(() => {
          followTimer = undefined;
          if (pending) apply(pending);
        }, RESIZE_FOLLOW_INTERVAL_MS);
      }
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      clearTimeout(followTimer);
      cleanupRef.current = null;
      setDragging(false);
      setGuidePx(null);
      // Land the exact final size once, so the release position is the one the
      // guide line showed rather than the last throttled step.
      if (pending) apply(pending);

      const layout: Record<string, number> = {};
      for (const [pid, state] of panels.current) {
        const px = state.getSize();
        if (px != null) layout[pid] = px;
      }
      onLayoutChanged.current?.(layout, { isUserInteraction: true });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    cleanupRef.current = onUp;
  };

  return { dragging, guidePx, onPointerDown };
}
