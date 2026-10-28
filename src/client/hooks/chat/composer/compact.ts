/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The phone composer's "give the height back" state, and the tap that ends it.
 *
 * A reader scrolled back through the transcript with an empty draft gets the
 * conversation's height back — the textarea is REMOVED rather than shrunk (a
 * shrunk one keeps a focusable element with no usable pixels and a
 * sentence-long placeholder clipped mid-word). `AttachmentToolbar` then carries
 * the "Type here" target that brings the box back.
 *
 * Two properties are load-bearing and each was a bug first:
 *
 *  - **The reopen flag is not derived from focus.** Re-opening removes the
 *    button that was tapped, so the browser emits a `focusout` for it in the
 *    same frame the textarea is being inserted — measured order:
 *    `focusin:BUTTON, focusout:BUTTON, ta-added, ta-removed`. Any flag derived
 *    from focus collapses the composer it just opened.
 *  - **The decision is made on POINTERDOWN, not click.** Pressing the target
 *    fires `focusin`, which expands the composer, which removes the button the
 *    finger is still on — so the pointerup lands on a different target and the
 *    browser emits no click at all (measured: `pd:BUTTON` with no `click:`
 *    line after it).
 *
 * Only reaching for something OUTSIDE the card takes the composer back to
 * compact: the reader asked for the box, and nothing the focus system does on
 * the way to it may take that back.
 */

import { useEffect, useState } from 'preact/hooks';
import type { RefObject } from 'preact/compat';
import type { Attachment } from '@/shared/types';

export interface ComposerCompactInput {
  /** The composer's card — the element the tap handler is bound to. */
  cardRef: RefObject<HTMLDivElement>;
  /** Only a phone gives its height back; a desktop sits beside the chat. */
  isMobile: boolean;
  /** The timeline says the reader is back through the transcript. */
  shrinkWhileReading: boolean;
  /** Anything inside the card has focus. */
  composerFocused: boolean;
  setComposerFocused: (focused: boolean) => void;
  value: string;
  attachments: Attachment[];
}

export interface ComposerCompact {
  /** True when the textarea must not be rendered. */
  compact: boolean;
  /** The reader tapped the card to get the box back. */
  reopen: () => void;
  /** The card's `onPointerDown`, for every state (focuses the draft when open). */
  onCardPointerDown: (event: PointerEvent) => void;
}

/** Controls that own their own press — a tap on one must not re-open the card. */
const OWN_PRESS = 'button, input, textarea, a, label, [role="button"]';

export function useComposerCompact({
  cardRef,
  isMobile,
  shrinkWhileReading,
  composerFocused,
  setComposerFocused,
  value,
  attachments,
}: ComposerCompactInput): ComposerCompact {
  const [reopenRequested, setReopenRequested] = useState(false);

  // A draft means the reader is writing, and a focused composer is the same
  // rule from the other side: the tap that re-opens it must not be undone by
  // the scroll position it was tapped from.
  const compact = isMobile
    && shrinkWhileReading
    && !composerFocused
    && !reopenRequested
    && !value.trim()
    && attachments.length === 0;

  // The tap ends with the caret where the reader aimed it. Runs on the commit
  // that put the textarea back in the DOM, which is why it cannot live in the
  // press handler. The flag is NOT cleared here — see the module note.
  useEffect(() => {
    if (!reopenRequested) return;
    cardRef.current?.querySelector('textarea')?.focus();
  }, [reopenRequested, cardRef]);

  useEffect(() => {
    if (!reopenRequested) return;
    const onOutside = (event: Event) => {
      if (cardRef.current?.contains(event.target as Node)) return;
      setReopenRequested(false);
      setComposerFocused(false);
    };
    document.addEventListener('pointerdown', onOutside);
    return () => document.removeEventListener('pointerdown', onOutside);
  }, [reopenRequested, cardRef, setComposerFocused]);

  const onCardPointerDown = (event: PointerEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest(OWN_PRESS)) {
      // The "Type here" target is the ONE control that must open the box; it is
      // marked rather than special-cased by its text.
      if (target.closest('[data-composer-reopen]')) setReopenRequested(true);
      return;
    }
    if (compact) {
      setReopenRequested(true);
      return;
    }
    cardRef.current?.querySelector('textarea')?.focus();
  };

  return { compact, reopen: () => setReopenRequested(true), onCardPointerDown };
}
