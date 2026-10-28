/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Full-screen viewer for a hydrated mermaid diagram.
 *
 * Opened by clicking a rendered diagram in the chat timeline (see
 * `MarkdownRenderer`), which hands over the SVG snapshot it read from the
 * inline block — the viewer never re-runs mermaid, so it shows exactly the
 * pixels the message shows. Opens fitted to the viewport and never upscales
 * past 100%: a small chart stays readable at its natural size.
 *
 * Interaction: wheel zooms around the cursor, drag pans, double-click toggles
 * fit/100%, the footer bar is the pointer-free equivalent, and Esc closes.
 */

import type { ComponentChildren, CSSProperties, TargetedPointerEvent, TargetedWheelEvent } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { Maximize2, Minus, Plus, X } from 'lucide-preact';
import type { DiagramSnapshot } from '@/client/components/common/diagram-viewer/read-block';

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
/** Viewport pixels kept clear around a fitted diagram (chrome + breathing room). */
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

export interface DiagramViewerProps extends DiagramSnapshot {
  onClose: () => void;
}

export function DiagramViewer({ svg, width, height, onClose }: DiagramViewerProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [fitScale, setFitScale] = useState(1);
  const [dragging, setDragging] = useState(false);

  /** Scale that fits the whole diagram in the stage without upscaling it. */
  const measureFit = useCallback(() => {
    const stage = stageRef.current?.getBoundingClientRect();
    if (!stage) return 1;
    return clampScale(
      Math.min(1, (stage.width - FIT_MARGIN) / width, (stage.height - FIT_MARGIN) / height),
    );
  }, [width, height]);

  const fitToView = useCallback(() => {
    const scale = measureFit();
    setFitScale(scale);
    setView({ scale, x: 0, y: 0 });
  }, [measureFit]);

  // Fit once per diagram size: re-measuring on every render would fight an
  // in-progress zoom, and only a size change (a re-render under a new theme
  // that produced a differently sized SVG) invalidates the current fit.
  useLayoutEffect(() => {
    fitToView();
  }, [fitToView]);

  // Modal focus: the stage owns the keyboard so the shortcuts below (and Esc)
  // never land in the composer still focused behind the overlay, and closing
  // hands focus back to whoever had it.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    stageRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  const zoomBy = useCallback((factor: number, anchorX?: number, anchorY?: number) => {
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
    setView((current) => (Math.abs(current.scale - 1) < 0.01 ? { scale: fitScale, x: 0, y: 0 } : { scale: 1, x: 0, y: 0 }));
  }, [fitScale]);

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

  // The overlay is the only scroller-free surface on screen; leaving `body`
  // scrollable lets a wheel outside the stage scroll the timeline behind it.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const canvasStyle: CSSProperties = {
    width: `${width}px`,
    height: `${height}px`,
    transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`,
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[200] bg-ink/85 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Diagram viewer"
      onWheel={handleWheel}
    >
      <div
        ref={stageRef}
        tabIndex={-1}
        className={`diagram-viewer-stage absolute inset-0 overflow-hidden outline-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDblClick={handleDoubleClick}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="diagram-viewer-canvas" style={canvasStyle} dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-4">
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-canvas/15 bg-paper/10 px-1.5 py-1 text-canvas backdrop-blur-sm">
          <ViewerButton label="Zoom out (-)" onClick={() => zoomBy(1 / ZOOM_STEP)}>
            <Minus size={14} />
          </ViewerButton>
          <span className="w-12 text-center font-mono text-[11px] tabular-nums text-canvas/80">
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
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-canvas/80 transition-colors hover:bg-canvas/10 hover:text-canvas"
    >
      {children}
    </button>
  );
}
