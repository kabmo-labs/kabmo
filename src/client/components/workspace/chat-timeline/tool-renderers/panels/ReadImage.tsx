/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The picture a `read` answers with, and the full-size view behind a click.
 *
 * The panel drew the result's own bytes with no affordance: a screenshot the
 * tool returned sat at `max-h-72`, so fine text in a 4K capture was unreadable
 * and there was no way to zoom it. The full-size surface is the same one the
 * `eval` screenshot strip opens (`ImageFullscreen` → `FullscreenViewer`): a
 * picture is one interaction wherever a tool returns one, and a second dialog
 * shell for this card is how two previews drift apart.
 */

import { useState } from 'preact/hooks';
import { ImageFullscreen } from '@/client/components/common/image-viewer/fullscreen';

interface ReadImageProps {
  /** Raw-byte URL the result carries, or the raw-file route for the path fallback. */
  src: string;
  /** The file's name, used as the `alt`, the dialog's label and the title. */
  name: string;
}

export function ReadImage({ src, name }: ReadImageProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-ink/8 bg-paper">
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={`${name} — open full size`}
          aria-label={`Open ${name} full size`}
          className="group flex max-h-80 w-full cursor-pointer items-center justify-center overflow-auto bg-canvas/60 p-3"
        >
          <img
            src={src}
            alt={name}
            className="max-h-72 max-w-full object-contain transition-opacity group-hover:opacity-90"
          />
        </button>
      </div>

      {open && <ImageFullscreen src={src} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}
