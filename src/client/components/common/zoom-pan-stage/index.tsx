/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The zoom/pan surface shared by every full-size picture in the editor.
 *
 * An image and a rendered diagram are the same interaction: a fixed-size
 * drawing, a stage that fits it once, wheel zoom anchored at the pointer,
 * drag to pan, double-click to toggle fit/100%, and a footer that names the
 * size and offers the same three controls. Stating that once is the point —
 * the image viewer and the drawio viewer used to be two copies of the same
 * arithmetic, and a fit that disagreed between them is exactly the kind of
 * defect a second copy produces.
 *
 * The content is measured, not declared: the caller renders whatever it has
 * (an `<img>`, a column of SVG pages) and the stage reads its layout size. That
 * is what lets a multi-page diagram fit as one document without the caller
 * computing caption heights.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren, TargetedPointerEvent, TargetedWheelEvent } from 'preact';

const MIN_SCALE = 0.1;
const MAX_SCALE = 16;
/** Zoom step for the buttons and the +/- keys. */
const ZOOM_STEP = 1.4;
/** Wheel `deltaY` → scale exponent, so zooming feels the same on every device. */
const WHEEL_SENSITIVITY = 0.0015;
/** Pixels kept clear around a fitted drawing. */
const FIT_MARGIN = 48;

export interface ZoomPanStageProps {
  /** Changes when the content's size may have changed, so the stage re-measures. */
  measureKey: unknown;
  /** Left slot of the footer; the measured size when omitted. */
  caption?: string;
  /** Rendered over the stage, unscaled — a loading spinner, a notice. */
  overlay?: ComponentChildren;
  className?: string;
  children: ComponentChildren;
}

interface Drag {
  pointerId: number;
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

export function ZoomPanStage({
  measureKey,
  caption,
  overlay,
  className = '',
  children,
}: ZoomPanStageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);

  const [size, setSize] = useState<Size | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  /**
   * Whether the user has moved the view themselves.
   *
   * A stage resize refits only while this is false: the editor panel is 320px
   * when a file opens and full-screen a click later, and a fit computed against
   * the narrow panel left the drawing at 40% in the wide one. Once the user has
   * zoomed or panned, their view outranks the container's size.
   */
  const userAdjustedRef = useRef(false);

  /** The content's layout size; transforms do not affect `offsetWidth`. */
  const measure = useCallback(() => {
    const element = contentRef.current;
    if (!element) return;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    if (width <= 0 || height <= 0) return;
    setSize((previous) =>
      previous && previous.width === width && previous.height === height ? previous : { width, height },
    );
  }, []);

  // A new drawing is a new view: the previous one's zoom and pan belong to
  // nothing on screen, so the fit applies even when the new content is the same
  // size as the old one (two 632×252 diagrams in one session).
  useLayoutEffect(() => {
    userAdjustedRef.current = false;
    measure();
  }, [measure, measureKey]);

  // A late layout change (a font, a wrapped caption) is a new size to fit.
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const element = contentRef.current;
    if (!element) return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);

  /** Scale that fits the whole drawing without upscaling it past 1. */
  const fitToView = useCallback(() => {
    const stage = stageRef.current?.getBoundingClientRect();
    if (!stage || !size) return;
    const fit = Math.min(
      1,
      (stage.width - FIT_MARGIN) / size.width,
      (stage.height - FIT_MARGIN) / size.height,
    );
    setScale(Math.max(MIN_SCALE, fit));
    setOffset({ x: 0, y: 0 });
    userAdjustedRef.current = false;
  }, [size]);

  // Fit once per size. Re-measuring on every render would fight an in-progress
  // zoom, and only a size change invalidates the current fit.
  useEffect(() => {
    if (size) fitToView();
  }, [size, fitToView]);

  const zoomBy = useCallback((factor: number) => {
    userAdjustedRef.current = true;
    setScale((current) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, current * factor)));
  }, []);

  // The stage's own size is a fit input too: a panel that grows must re-fit a
  // drawing that was fitted to the narrow one.
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(() => {
      if (!userAdjustedRef.current) fitToView();
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [fitToView]);

  const handleWheel = useCallback(
    (event: TargetedWheelEvent<HTMLDivElement>) => {
      // Without this the editor panel scrolls while zooming.
      event.preventDefault();
      zoomBy(Math.exp(-event.deltaY * WHEEL_SENSITIVITY));
    },
    [zoomBy],
  );

  const handlePointerDown = useCallback(
    (event: TargetedPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !size) return;
      userAdjustedRef.current = true;
      dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    },
    [size],
  );

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
  const dimensions = size ? `${size.width} × ${size.height} px` : '';

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
        className={`relative flex-1 overflow-hidden outline-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            ref={contentRef}
            className="shrink-0"
            style={{
              transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
              visibility: size ? 'visible' : 'hidden',
            }}
          >
            {children}
          </div>
        </div>
        {overlay}
      </div>

      <div className="flex flex-shrink-0 items-center justify-between border-t border-ink/10 bg-canvas px-3 py-1.5 font-mono text-[10px] text-ink/50">
        <span>{caption ?? dimensions}</span>
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
