/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * When the desktop composer stops having room for its labels.
 *
 * The card lives in a chat column the reader can drag down to a third of the
 * window, so its width is not the viewport's — and the toolbar's own labels are
 * what run out of room first. Measured in Chromium at 1440x900 by narrowing the
 * column: at a 521px card the model chip was squeezed to 41px and painted
 * `kenari` over the thinking chip beside it, and every label from `auto` to
 * `Goal` was cut mid-word. The labels only fit from ~526px of card width with
 * the default provider; the provider is never truncated (two accounts can share
 * a prefix), so a longer name costs its own width on top.
 *
 * 560 is that measurement plus the headroom a longer provider name needs. Below
 * it the composer takes the PHONE's arrangement — icon-only chips, Plan/Goal
 * moved up to the attachment row, the 32px action pair — instead of truncating
 * each label to a letter.
 *
 * That verdict has to be JavaScript, not a container query: which ROW hosts the
 * mode toggles is decided while rendering, and CSS can only hide a span inside a
 * row that already exists. So the flag is measured here and handed down, and the
 * `@[420px]`/`@[520px]` container queries the chips used to carry are gone —
 * two mechanisms for one fact is how one chip hides its label while its
 * neighbour keeps a two-line one.
 */

import { useEffect, useState } from 'preact/hooks';

/**
 * The card's CONTENT width, in CSS px, below which the phone arrangement wins.
 *
 * Content, not border box: the observer reports `contentRect`, which is the box
 * the rows lay themselves out in (the card's 1px border is not available to
 * them). A 562px card therefore measures 560 here.
 */
export const COMPOSER_NARROW_MAX_WIDTH_PX = 560;

/**
 * The verdict for one measured width.
 *
 * `0` means "not laid out yet" — a card inside a hidden panel, or the first
 * ResizeObserver tick of a display:none subtree. Reporting narrow there would
 * redraw a desktop composer in the phone arrangement the moment it is shown, so
 * an unmeasurable card keeps the arrangement it was configured with.
 */
export function resolveComposerNarrow(width: number): boolean {
  return width > 0 && width < COMPOSER_NARROW_MAX_WIDTH_PX;
}

/** The element shape the hook needs; keeps the signature free of a Preact import. */
export interface ComposerCardRef {
  readonly current: HTMLElement | null;
}

/**
 * Whether this composer card is too narrow for the desktop toolbar.
 *
 * Re-renders only when the verdict flips, not on every pixel of a column drag:
 * the observer fires for each frame of the resize, and a `setState` per frame
 * would rebuild the toolbar (and the model picker inside it) 60 times a second.
 */
export function useComposerNarrow(ref: ComposerCardRef): boolean {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? element.getBoundingClientRect().width;
      const next = resolveComposerNarrow(measured);
      setNarrow((previous) => (previous === next ? previous : next));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return narrow;
}
