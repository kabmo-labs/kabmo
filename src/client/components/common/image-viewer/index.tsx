/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The picture surface used wherever a file is opened and turns out to be an
 * image — the desktop editor panel, the phone's full-screen editor, and the
 * chat `read` tool card. An image has no text, so this replaces the code
 * surface entirely: an `<img>` against the raw-byte route, a checker backdrop
 * for transparency, and zoom/pan that mirror the diagram viewer so the two
 * full-size viewers behave the same way.
 *
 * The zoom/pan itself is `ZoomPanStage`: the same interaction draws a rendered
 * diagram, and two copies of the fit arithmetic is how the two surfaces drift.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { AlertTriangle, Loader2 } from 'lucide-preact';
import { ZoomPanStage } from '@/client/components/common/zoom-pan-stage';

interface ImageViewerProps {
  /** Raw-byte URL; a different URL is a different picture. */
  src: string;
  name: string;
  className?: string;
}

/**
 * The stateful surface, keyed on `src` by `ImageViewer` — remounting on a new
 * URL is what guarantees a refresh cannot inherit the previous picture's fit,
 * pan offset, or decode error.
 */
function ImageSurface({ src, name, className = '' }: ImageViewerProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Read the decoded size off the element; false while it is not decodable yet. */
  const measure = useCallback((): boolean => {
    const image = imageRef.current;
    if (!image || !image.complete || image.naturalWidth === 0) return false;
    setNatural({ width: image.naturalWidth, height: image.naturalHeight });
    return true;
  }, []);

  // A cached picture can be complete before its `load` handler is attached, so
  // the size is read once on mount as well — otherwise a re-opened image sat
  // at 100% with no dimensions reported and Fit had nothing to fit to.
  useEffect(() => {
    measure();
  }, [measure]);

  if (error) {
    return (
      <div className={`flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center bg-paper ${className}`}>
        <AlertTriangle size={20} className="text-error" />
        <span className="font-sans text-xs text-error">Could not read {name}</span>
        <span className="break-all font-mono text-[11px] text-ink/50">{error}</span>
      </div>
    );
  }

  return (
    <ZoomPanStage
      className={className}
      // The natural size is what the stage has to fit; the element's own layout
      // box is the picture at 1×, which is what `measure` reads.
      measureKey={natural}
      caption={natural ? `${natural.width} × ${natural.height} px` : ''}
      overlay={
        natural ? null : (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-ink/40">
            <Loader2 size={14} className="animate-spin" />
            <span>Loading image…</span>
          </div>
        )
      }
    >
      <img
        ref={imageRef}
        src={src}
        alt={name}
        draggable={false}
        onLoad={measure}
        onError={() => setError('The file could not be decoded as an image.')}
        className="image-canvas max-h-none max-w-none select-none"
        style={{ visibility: natural ? 'visible' : 'hidden' }}
      />
    </ZoomPanStage>
  );
}

export function ImageViewer(props: ImageViewerProps) {
  return <ImageSurface key={props.src} {...props} />;
}
