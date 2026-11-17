/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A picture opened at full size from a chat tool card (`ToolScreenshots`).
 *
 * It is the same surface a rendered diagram opens into — dark full-bleed
 * overlay, fit, cursor-anchored wheel zoom, drag to pan, the floating control
 * pill, Esc — because `FullscreenViewer` owns that shell. The only thing this
 * file states is the picture itself: the `<img>` at its natural pixel size (so
 * the shell can measure it), and the two states that are not a picture yet — a
 * decode in flight and a file the browser refused.
 */

import { useState } from 'preact/hooks';
import { AlertTriangle, Loader2 } from 'lucide-preact';
import { FullscreenViewer } from '@/client/components/common/fullscreen-viewer';

export interface ImageFullscreenProps {
  /** Raw-byte URL; a different URL is a different picture. */
  src: string;
  /** Dialog and `alt` text — what the reader clicked. */
  name: string;
  onClose: () => void;
}

export function ImageFullscreen({ src, name, onClose }: ImageFullscreenProps) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  return (
    <FullscreenViewer
      onClose={onClose}
      ariaLabel={name}
      // Remounting on a new URL (`src`) is what stops a refresh inheriting the
      // previous picture's fit — the shell fits once it has a measured size.
      measureKey={src}
      overlay={
        state === 'error' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
            <AlertTriangle size={20} className="text-error" />
            <span className="font-sans text-xs text-on-ink-muted">Could not decode {name}</span>
          </div>
        ) : state === 'loading' ? (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-on-ink-muted">
            <Loader2 size={14} className="animate-spin" />
            <span>Loading image…</span>
          </div>
        ) : null
      }
    >
      <img
        src={src}
        alt={name}
        draggable={false}
        onLoad={() => setState('ready')}
        onError={() => setState('error')}
        className="select-none"
        style={{ visibility: state === 'ready' ? 'visible' : 'hidden' }}
      />
    </FullscreenViewer>
  );
}
