/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The model picker at FULL SCREEN, for a phone.
 *
 * Not a bottom sheet. A sheet still gives away the top of the screen and still
 * has to guess a cap (`86dvh` was the first attempt); a phone surface that is
 * choosing the model for the next turn can own the screen instead, which is what
 * the platform's own settings and picker surfaces do. The measured result on a
 * 390x844 phone: a 500px sheet left 344px of dead canvas above it and showed
 * ~7 model rows; the full screen shows 15.
 *
 * PORTALLED to `<body>`, not rendered in place. The composer card can become a
 * containing block for `position: fixed` through `backdrop-filter` (its own
 * `glass` style), a `transform`, or `contain: layout` — and then `inset-0`
 * sizes the overlay to the CARD instead of the screen. Measured in Chromium at
 * 1440x900: re-parenting a dialog's scrim into `[data-composer-style]` took it
 * from 1440x900 at (0,0) to 710x164 at the card's box.
 *
 * `100dvh`, not `100vh`: `vh` is the LARGEST viewport on a phone, so an overlay
 * sized from it runs under the browser chrome. The header carries
 * `env(safe-area-inset-top)` and the footer `…-bottom`, so neither the close
 * control nor the last model row sits under a notch or a home indicator.
 */

import { useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { createPortal } from 'preact/compat';
import { X } from 'lucide-preact';
import { useKeyboardInset } from '@/client/hooks/ui/keyboard-inset';
import { titlebarPaddingLeft, titlebarPaddingRight } from '@/shared/lib/ui/titlebar';

interface ModelFullscreenProps {
  open: boolean;
  onClose: () => void;
  /** The picker's own card content — one tree, shared with the popover. */
  children: ComponentChildren;
}

export function ModelFullscreen({ open, onClose, children }: ModelFullscreenProps) {
  // The search field focuses the soft keyboard, which covers the bottom rows.
  // The inset is measured from THIS frame's own bottom edge, so it lifts by
  // exactly the overlap and lifts by nothing when the browser already shrank the
  // viewport — the reason `useKeyboardInset` derives the lift from geometry
  // rather than `innerHeight`. The ref must be created before the early return,
  // because hooks cannot be conditional.
  const frameRef = useRef<HTMLDivElement>(null);
  const keyboardInset = useKeyboardInset(frameRef, open);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={frameRef}
      role="dialog"
      aria-modal="true"
      aria-label="Select model"
      className="fixed inset-0 z-[70] flex h-dvh flex-col bg-paper text-xs"
    >
      <header
        className="flex flex-shrink-0 items-center justify-between border-b border-ink/10 bg-canvas"
        style={{
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingLeft: titlebarPaddingLeft('0.75rem', true),
          paddingRight: titlebarPaddingRight('0.75rem', true),
        }}
      >
        <span className="py-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink/50">Model</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-1 rounded-lg p-1.5 text-ink/60 transition-colors hover:bg-ink/5 hover:text-ink"
        >
          <X size={16} />
        </button>
      </header>
      <div
        className="flex min-h-0 flex-1 flex-col"
        style={{
          paddingBottom: keyboardInset > 0
            ? keyboardInset
            : 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
