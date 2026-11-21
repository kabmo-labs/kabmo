/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The picker's close control, drawn on whichever row the frame's first band is.
 *
 * The full-screen model picker used to own a header of its own — a 36px band
 * containing the word "Model" and this `X`. That band sat above the harness
 * strip, so the phone spent TWO chrome rows (85px of an 844px screen) on a
 * surface whose whole job is to list models, and the word named the thing the
 * user had just tapped. The control now rides the strip's trailing edge (or the
 * search row when the picker offers no harness tabs), and the frame draws no
 * header at all.
 *
 * One component for both rows, because the button has to look the same wherever
 * the first band lands — a second `X` written inline is how the two would pick
 * different sizes, which is exactly the drift the phone headers were fixed for.
 */

import { X } from 'lucide-preact';
import { CONTROL_BOX, CONTROL_GLYPH_PX } from '@/client/lib/ui/control-plate';

export function PickerCloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close"
      // The phone header row's own box and glyph: the picker is a phone title
      // bar, so its controls are the same 36px plate as the drawer's close.
      className={`${CONTROL_BOX.mobile} flex-none cursor-pointer rounded-lg text-ink/60 transition-colors hover:bg-ink/5 hover:text-ink`}
    >
      <X size={CONTROL_GLYPH_PX.mobile} />
    </button>
  );
}
