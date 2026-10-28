/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * How far a bottom-anchored panel must lift so a soft keyboard does not cover
 * it.
 *
 * The measurement is taken from the PANEL'S OWN geometry, not from
 * `window.innerHeight`: the overlap between the panel's bottom edge and the
 * visible bottom edge is what actually matters, and it is self-correcting.
 *
 * The difference matters because `innerHeight` is not a stable reference. A
 * browser that shrinks it when the keyboard opens, a `dvh` container that
 * tracks it, or a panel that already ends above the keyboard all change what
 * "the keyboard height" means — and computing `innerHeight - visualHeight`
 * against a height that already moved lifts the panel by the keyboard's height
 * a second time, which is the too-far margin. Deriving the lift from the
 * overlap yields zero in every one of those cases and the exact height only
 * when the panel genuinely runs under the keyboard.
 *
 * Deliberately local to the panel that uses it. Putting
 * `interactive-widget=resizes-content` in the viewport meta would solve this
 * globally, but it changes how every surface in the app sizes itself when the
 * keyboard opens — a whole-app layout decision, not a terminal one.
 */

import { useEffect, useState } from 'preact/hooks';

/** Ignore small overlaps: a collapsing URL bar is not a keyboard. */
const MIN_KEYBOARD_INSET_PX = 80;

/** The element shape the hook needs; keeps the signature free of a Preact import. */
export interface PanelRef {
  readonly current: HTMLElement | null;
}

/**
 * The lift for one measurement pair, in CSS px.
 *
 * `panelBottom` is the panel's bottom edge and `visibleBottom` the visible
 * area's bottom edge, both in the same coordinate space. Pure so the cases
 * below can be pinned without a DOM.
 */
export function resolveKeyboardInset(panelBottom: number, visibleBottom: number): number {
  // A non-positive visible bottom is a browser reporting nonsense; lifting by
  // it would squeeze the panel to nothing, so the failure mode is "no keyboard".
  if (visibleBottom <= 0) return 0;
  const overlap = panelBottom - visibleBottom;
  if (overlap < MIN_KEYBOARD_INSET_PX) return 0;
  return Math.round(overlap);
}

export function useKeyboardInset(ref: PanelRef, enabled = true): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element) {
      // Disabled (or the panel is not mounted yet): report no keyboard rather
      // than leaving a lift the caller is no longer applying. A docked composer
      // measures only while it is stretched, so this keeps it from re-rendering
      // on every visual-viewport scroll for a padding it never renders.
      setInset((previous) => (previous === 0 ? previous : 0));
      return;
    }

    let frame: number | null = null;
    const measure = () => {
      frame = null;
      const viewport = window.visualViewport;
      if (!viewport) {
        setInset((previous) => (previous === 0 ? previous : 0));
        return;
      }
      // `offsetTop` + `height` is the visible area's bottom edge within the
      // layout viewport, which is the space `getBoundingClientRect` reports in.
      const next = resolveKeyboardInset(
        element.getBoundingClientRect().bottom,
        viewport.offsetTop + viewport.height,
      );
      setInset((previous) => (previous === next ? previous : next));
    };

    // Deferred by a frame: `visualViewport.resize` fires BEFORE the container
    // reflows for the keyboard, so measuring in the handler reads the old, full
    // height and lifts by the keyboard twice over. One frame later the layout
    // has settled and the panel's own bottom edge is the truth.
    const schedule = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(measure);
    };

    // The container can also shrink with no viewport event at all (a `dvh`
    // wrapper tracking the keyboard, a drawer resized by the layout). Watching
    // the panel's BORDER box catches that without a feedback loop: our own
    // padding changes the content box only.
    const observer = new ResizeObserver(schedule);
    observer.observe(element, { box: 'border-box' });

    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    schedule();

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
    };
  }, [ref, enabled]);

  return inset;
}
