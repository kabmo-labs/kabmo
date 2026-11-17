/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Full-screen zoom/pan shell for a fixed-size drawing opened from the chat: a
 * rendered mermaid diagram (`common/diagram-viewer`) and a tool result's
 * picture (`common/image-viewer`). They are the same interaction — a drawing
 * fitted to the viewport, wheel zoom around the cursor, drag to pan,
 * double-click to toggle fit/100%, a floating control pill, Esc to close — so
 * they are this one component. Two copies of it is how the image lightbox ended
 * up a white, header-chromeashed modal while a diagram was a dark full-bleed
 * surface; the shell states the look and the arithmetic once.
 *
 * The drawing is MEASURED, not declared: the caller renders whatever it has (an
 * `<img>`, an SVG at its natural pixel size) and the shell reads the layout
 * box. That is what lets a screenshot, whose size is unknown until it decodes,
 * fit exactly like a diagram whose size was read from the markup.
 */

import type { ComponentChildren, TargetedPointerEvent, TargetedWheelEvent } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { Maximize2, Minus, Plus, X } from 'lucide-preact';

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
/** Viewport pixels kept clear around a fitted drawing (chrome + breathing room). */
const FIT_MARGIN = 112;
/** One button press / keyboard notch. */
const ZOOM_STEP = 1.4;
/** Wheel `deltaY` → scale exponent, so zooming feels the same on every device. */
const WHEEL_SENSITIVITY = 0.0015;

interface View {
  scale: number;
  /** Translation of the canvas centre from the stage centre, in stage px. */
  x: number;
  y: number;
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

const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

/** Zoom `view` to `scale` keeping the screen point (`anchorX`,`anchorY`) under
 *  the cursor, which is what makes wheel-zoom feel anchored rather than
 *  centre-locked. The canvas grows from its centre, so the anchor is converted
 *  to a centre-relative point before solving. */
function zoomTo(view: View, scale: number, anchorX: number, anchorY: number, stage: DOMRect | undefined): View {
  const next = clampScale(scale);
  if (next === view.scale) return view;
  const px = stage ? anchorX - (stage.left + stage.width / 2) : 0;
  const py = stage ? anchorY - (stage.top + stage.height / 2) : 0;
  const k = next / view.scale;
  return { scale: next, x: px - (px - view.x) * k, y: py - (py - view.y) * k };
}

export interface FullscreenViewerProps {
  onClose: () => void;
  /** Accessible name of the dialog — the diagram or the picture it shows. */
  ariaLabel: string;
  /** Changes when the drawing's size may have changed, so the shell re-measures. */
  measureKey: unknown;
  /** Rendered over the stage, unscaled — a spinner, a decode refusal. */
  overlay?: ComponentChildren;
  children: ComponentChildren;
}

export function FullscreenViewer({ onClose, ariaLabel, measureKey, overlay, children }: FullscreenViewerProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  /** Whether the reader moved the view themselves: a later measurement then
   *  must not yank their zoom back to a fit. An image that decodes after mount
   *  grows from 0 to its natural size, so the first real measurement HAS to
   *  fit. */
  const userAdjustedRef = useRef(false);

  /** The drawing's layout size; transforms do not affect `offsetWidth`. */
  const measure = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = canvas.offsetWidth;
    const height = canvas.offsetHeight;
    if (width <= 0 || height <= 0) return;
    setSize((previous) =>
      previous && previous.width === width && previous.height === height ? previous : { width, height },
    );
  }, []);

  // A new drawing is a new view: the previous one's zoom and pan belong to
  // nothing on screen, so the fit applies even when the new drawing is the same
  // size as the old one (two 632×252 diagrams in one session).
  useLayoutEffect(() => {
    userAdjustedRef.current = false;
    measure();
  }, [measure, measureKey]);

  // A late layout change — an image finishing its decode, a themed re-render
  // producing a differently sized SVG — is a new size to fit.
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [measure]);

  /** Scale that fits the whole drawing in the stage without upscaling it. */
  const fitToView = useCallback(() => {
    const stage = stageRef.current?.getBoundingClientRect();
    if (!stage || !size) return;
    const fit = Math.min(1, (stage.width - FIT_MARGIN) / size.width, (stage.height - FIT_MARGIN) / size.height);
    setView({ scale: clampScale(fit), x: 0, y: 0 });
    userAdjustedRef.current = false;
  }, [size]);

  // Fit once per measured size: re-measuring on every render would fight an
  // in-progress zoom.
  useLayoutEffect(() => {
    fitToView();
  }, [fitToView]);

  // The stage's own size is a fit input too: a window that grows must re-fit a
  // drawing that was fitted to the smaller viewport.
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

  const zoomBy = useCallback((factor: number, anchorX?: number, anchorY?: number) => {
    userAdjustedRef.current = true;
    setView((current) => {
      const stage = stageRef.current?.getBoundingClientRect();
      const x = anchorX ?? (stage ? stage.left + stage.width / 2 : 0);
      const y = anchorY ?? (stage ? stage.top + stage.height / 2 : 0);
      return zoomTo(current, current.scale * factor, x, y, stage);
    });
  }, []);

  const handleWheel = useCallback(
    (event: TargetedWheelEvent<HTMLDivElement>) => {
      // Without this the timeline behind the overlay scrolls while zooming.
      event.preventDefault();
      zoomBy(Math.exp(-event.deltaY * WHEEL_SENSITIVITY), event.clientX, event.clientY);
    },
    [zoomBy],
  );

  const handlePointerDown = useCallback((event: TargetedPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    userAdjustedRef.current = true;
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }, []);

  const handlePointerMove = useCallback((event: TargetedPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
  }, []);

  const endDrag = useCallback((event: TargetedPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
  }, []);

  const handleDoubleClick = useCallback(() => {
    if (Math.abs(view.scale - 1) < 0.01) {
      fitToView();
      return;
    }
    userAdjustedRef.current = true;
    setView({ scale: 1, x: 0, y: 0 });
  }, [view.scale, fitToView]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoomBy(ZOOM_STEP);
        return;
      }
      if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        zoomBy(1 / ZOOM_STEP);
        return;
      }
      if (event.key === '0') {
        event.preventDefault();
        fitToView();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, zoomBy, fitToView]);

  // Modal focus: the stage owns the keyboard so the shortcuts above (and Esc)
  // never land in the composer still focused behind the overlay, and closing
  // hands focus back to whoever had it.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    stageRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  // The overlay is the only scroller-free surface on screen; leaving `body`
  // scrollable lets a wheel outside the stage scroll the timeline behind it.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-[200] bg-ink/85 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onWheel={handleWheel}
    >
      <div
        ref={stageRef}
        tabIndex={-1}
        className={`fullscreen-viewer-stage absolute inset-0 overflow-hidden outline-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDblClick={handleDoubleClick}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            ref={canvasRef}
            className="fullscreen-viewer-canvas"
            style={{
              transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`,
              visibility: size ? 'visible' : 'hidden',
            }}
          >
            {children}
          </div>
        </div>
        {overlay}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-4">
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-canvas/15 bg-paper/10 px-1.5 py-1 text-canvas backdrop-blur-sm">
          <ViewerButton label="Zoom out (-)" onClick={() => zoomBy(1 / ZOOM_STEP)}>
            <Minus size={14} />
          </ViewerButton>
          <span className="w-12 text-center font-mono text-[11px] tabular-nums text-on-ink-muted">
            {Math.round(view.scale * 100)}%
          </span>
          <ViewerButton label="Zoom in (+)" onClick={() => zoomBy(ZOOM_STEP)}>
            <Plus size={14} />
          </ViewerButton>
          <ViewerButton label="Fit to view (0)" onClick={fitToView}>
            <Maximize2 size={14} />
          </ViewerButton>
          <ViewerButton label="Close (Esc)" onClick={onClose}>
            <X size={14} />
          </ViewerButton>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ViewerButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ComponentChildren;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="cursor-pointer rounded-full p-1.5 transition-colors hover:bg-canvas/10"
    >
      {children}
    </button>
  );
}
