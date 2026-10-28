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
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { TargetedPointerEvent, TargetedWheelEvent } from 'preact';
import { AlertTriangle, Loader2 } from 'lucide-preact';

const MIN_SCALE = 0.1;
const MAX_SCALE = 16;
/** Zoom step for the buttons and the +/- keys. */
const ZOOM_STEP = 1.4;
/** Wheel `deltaY` → scale exponent, matching the diagram viewer's feel. */
const WHEEL_SENSITIVITY = 0.0015;
/** Pixels kept clear around a fitted picture. */
const FIT_MARGIN = 48;

interface ImageViewerProps {
  /** Raw-byte URL; a different URL is a different picture. */
  src: string;
  name: string;
  className?: string;
}

interface Drag {
  pointerId: number;
  x: number;
  y: number;
}

/**
 * The stateful surface, keyed on `src` by `ImageViewer` — remounting on a new
 * URL is what guarantees a refresh cannot inherit the previous picture's fit,
 * pan offset, or decode error.
 */
function ImageSurface({ src, name, className = '' }: ImageViewerProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<Drag | null>(null);

  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
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

  /** Scale that fits the whole picture without upscaling it past 1. */
  const fitToView = useCallback(() => {
    const image = imageRef.current;
    const stage = stageRef.current?.getBoundingClientRect();
    const width = image?.naturalWidth ?? 0;
    const height = image?.naturalHeight ?? 0;
    if (!stage || !width || !height) return;
    setScale(
      Math.min(
        1,
        Math.max(MIN_SCALE, (stage.width - FIT_MARGIN) / width, (stage.height - FIT_MARGIN) / height),
      ),
    );
    setOffset({ x: 0, y: 0 });
  }, []);

  // Fit once per picture. Re-measuring on every render would fight an
  // in-progress zoom, and `natural` only changes for a new decode.
  useEffect(() => {
    if (natural) fitToView();
  }, [natural, fitToView]);

  const zoomBy = useCallback((factor: number) => {
    setScale((current) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, current * factor)));
  }, []);

  const handleWheel = useCallback(
    (event: TargetedWheelEvent<HTMLDivElement>) => {
      // Without this the editor panel scrolls while zooming.
      event.preventDefault();
      zoomBy(Math.exp(-event.deltaY * WHEEL_SENSITIVITY));
    },
    [zoomBy],
  );

  const handlePointerDown = useCallback((event: TargetedPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !natural) return;
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }, [natural]);

  const handlePointerMove = useCallback((event: TargetedPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    setOffset((current) => ({ x: current.x + dx, y: current.y + dy }));
  }, []);

  const endDrag = useCallback((event: TargetedPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
  }, []);

  const handleDoubleClick = useCallback(() => {
    if (Math.abs(scale - 1) < 0.01) fitToView();
    else {
      setScale(1);
      setOffset({ x: 0, y: 0 });
    }
  }, [scale, fitToView]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== '+' && event.key !== '=' && event.key !== '-' && event.key !== '_' && event.key !== '0') return;
      // The stage owns these keys only while it has focus; a window-level
      // listener would steal `-`/`0` from the composer and the file search box.
      const target = event.target as HTMLElement | null;
      if (!target || !stageRef.current?.contains(target)) return;
      event.preventDefault();
      if (event.key === '0') fitToView();
      else if (event.key === '+' || event.key === '=') zoomBy(ZOOM_STEP);
      else zoomBy(1 / ZOOM_STEP);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomBy, fitToView]);

  const percent = Math.round(scale * 100);
  const dimensions = natural ? `${natural.width} × ${natural.height} px` : '';

  return (
    <div className={`relative flex h-full w-full flex-col bg-paper ${className}`}>
      <div
        ref={stageRef}
        tabIndex={-1}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDblClick={handleDoubleClick}
        className={`image-stage relative flex-1 overflow-hidden outline-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      >
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <AlertTriangle size={20} className="text-error" />
            <span className="font-sans text-xs text-error">Could not read {name}</span>
            <span className="break-all font-mono text-[11px] text-ink/50">{error}</span>
          </div>
        ) : (
          <>
            {!natural && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-ink/40">
                <Loader2 size={14} className="animate-spin" />
                <span>Loading image…</span>
              </div>
            )}
            <div className="absolute inset-0 flex items-center justify-center">
              <img
                ref={imageRef}
                src={src}
                alt={name}
                draggable={false}
                onLoad={measure}
                onError={() => setError('The file could not be decoded as an image.')}
                className="image-canvas max-h-none max-w-none select-none"
                style={{
                  transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
                  visibility: natural ? 'visible' : 'hidden',
                }}
              />
            </div>
          </>
        )}
      </div>

      <div className="flex flex-shrink-0 items-center justify-between border-t border-ink/10 bg-canvas px-3 py-1.5 font-mono text-[10px] text-ink/50">
        <span>{dimensions}</span>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => zoomBy(1 / ZOOM_STEP)} className="hover:text-ink" title="Zoom out (-)">
            −
          </button>
          <span className="w-10 text-center tabular-nums">{percent}%</span>
          <button type="button" onClick={() => zoomBy(ZOOM_STEP)} className="hover:text-ink" title="Zoom in (+)">
            +
          </button>
          <button type="button" onClick={fitToView} className="hover:text-ink" title="Fit to view (0)">
            Fit
          </button>
        </div>
      </div>
    </div>
  );
}

export function ImageViewer(props: ImageViewerProps) {
  return <ImageSurface key={props.src} {...props} />;
}
