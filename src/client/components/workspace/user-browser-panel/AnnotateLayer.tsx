/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The drawing surface over the user's page.
 *
 * It sits INSIDE the wrapper that carries the panel's CSS `zoom` and viewport
 * preset, so `inset: 0` already covers the iframe exactly — verified in
 * Chromium at 150% zoom: iframe and overlay both measured 900×450. Pointer
 * positions are normalized against this element's own measured rect, which is
 * why a mark survives a zoom change: the ratio is the same at every scale.
 *
 * While the layer is mounted the iframe is inert — the overlay takes every
 * pointer event, because a drag that reached the page would both navigate the
 * user away and lose the mark. The bar above says so in words.
 *
 * Marks are geometry only. The page inside is cross-origin, so there are no
 * pixels to draw them on: what the agent receives is the region and the words
 * (`shared/lib/browser/annotate.ts`).
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { normalizePoint, shapeRegion } from '@/shared/lib/browser/annotate';
import { nextShapeId } from '@/client/hooks/browser/use-annotate';
import type { AnnotatePoint, AnnotateShape, AnnotateTool } from '@/shared/types';

export interface AnnotateLayerProps {
  shapes: AnnotateShape[];
  tool: AnnotateTool;
  selectedId: string | null;
  /** Logical panel size in CSS px (zoom removed), for the prompt. */
  onMeasure: (size: { width: number; height: number }) => void;
  onAdd: (shape: AnnotateShape) => void;
  onSelect: (id: string | null) => void;
}

/** Below this, a drag is a click: not a region, so it is not a mark. */
const MIN_DRAG_PX = 4;

/**
 * Marks are drawn with the error colour, the one chroma the palette allows
 * outside Shiki. A mark is a complaint about the page, and it must not read as
 * part of the page it is drawn over.
 */
const MARK_COLOR = 'var(--theme-error)';

export function AnnotateLayer({ shapes, tool, selectedId, onMeasure, onAdd, onSelect }: AnnotateLayerProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  // The mark being dragged lives in a REF, and the state copy exists only to
  // paint it. A pointerdown → pointerup pair that lands inside one frame would
  // otherwise read the closure's `null` draft and drop the mark: measured with
  // this component's own tests, a fast drag never reached `onAdd`.
  const draftRef = useRef<AnnotateShape | null>(null);
  const [draft, setDraft] = useState<AnnotateShape | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  // The panel's own size, reported on every resize so the prompt states the box
  // the marks were actually drawn against.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const report = () => {
      const rect = surface.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      setBox((prev) => (prev.width === rect.width && prev.height === rect.height ? prev : { width: rect.width, height: rect.height }));
      onMeasure({ width: rect.width, height: rect.height });
    };
    report();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(report);
    observer.observe(surface);
    return () => observer.disconnect();
  }, [onMeasure]);

  const pointOf = (event: PointerEvent): { normalized: AnnotatePoint; px: number; py: number } | null => {
    const surface = surfaceRef.current;
    if (!surface) return null;
    const rect = surface.getBoundingClientRect();
    const local = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    return { normalized: normalizePoint(rect, local), px: local.x, py: local.y };
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const point = pointOf(event);
    if (!point) return;
    event.preventDefault();
    onSelect(null);
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    const next: AnnotateShape = { id: nextShapeId(), tool, start: point.normalized, end: point.normalized, label: '', note: '' };
    draftRef.current = next;
    setDraft(next);
  };

  const handlePointerMove = (event: PointerEvent) => {
    const current = draftRef.current;
    if (!current) return;
    const point = pointOf(event);
    if (!point) return;
    const next = { ...current, end: point.normalized };
    draftRef.current = next;
    setDraft(next);
  };

  const handlePointerUp = (event: PointerEvent) => {
    const current = draftRef.current;
    if (!current) return;
    const point = pointOf(event);
    const finished = point ? { ...current, end: point.normalized } : current;
    draftRef.current = null;
    setDraft(null);
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    // A click with no drag is not a region. A pin IS a point, so it always counts.
    if (finished.tool !== 'pin') {
      const rect = surfaceRef.current?.getBoundingClientRect();
      const dragPx = rect
        ? Math.hypot((finished.end.x - finished.start.x) * rect.width, (finished.end.y - finished.start.y) * rect.height)
        : 0;
      if (dragPx < MIN_DRAG_PX) return;
    }
    onAdd(finished);
  };

  const cancel = () => {
    draftRef.current = null;
    setDraft(null);
  };

  const painted = draft ? [...shapes, draft] : shapes;

  return (
    <div
      ref={surfaceRef}
      className="absolute inset-0 cursor-crosshair touch-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={cancel}
    >
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox={`0 0 ${Math.max(1, box.width)} ${Math.max(1, box.height)}`}
        preserveAspectRatio="none"
        aria-label="Page annotation area"
      >
        {painted.map((shape, index) => (
          <ShapeMark
            key={shape.id}
            shape={shape}
            index={index + 1}
            box={box}
            selected={shape.id === selectedId}
            onSelect={() => onSelect(shape.id)}
          />
        ))}
      </svg>
    </div>
  );
}

interface ShapeMarkProps {
  shape: AnnotateShape;
  index: number;
  box: { width: number; height: number };
  selected: boolean;
  onSelect: () => void;
}

/**
 * One mark. The number is drawn at the mark's own anchor so the prompt's
 * "1." can be found on screen without reading the whole overlay.
 */
function ShapeMark({ shape, index, box, selected, onSelect }: ShapeMarkProps) {
  const start = { x: shape.start.x * box.width, y: shape.start.y * box.height };
  const end = { x: shape.end.x * box.width, y: shape.end.y * box.height };
  const region = shapeRegion(shape);
  const stroke = selected ? 3 : 2;
  const label = String(index);

  const select = (event: PointerEvent) => {
    event.stopPropagation();
    event.preventDefault();
    onSelect();
  };

  return (
    <g onPointerDown={select} className="cursor-pointer">
      {shape.tool === 'box' && (
        <rect
          x={region.x * box.width}
          y={region.y * box.height}
          width={Math.max(1, region.width * box.width)}
          height={Math.max(1, region.height * box.height)}
          fill={MARK_COLOR}
          fillOpacity={selected ? 0.16 : 0.1}
          stroke={MARK_COLOR}
          strokeWidth={stroke}
          vectorEffect="non-scaling-stroke"
          rx={3}
        />
      )}
      {shape.tool === 'arrow' && (
        <>
          <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={MARK_COLOR} strokeWidth={stroke} vectorEffect="non-scaling-stroke" />
          <circle cx={end.x} cy={end.y} r={4} fill={MARK_COLOR} />
        </>
      )}
      {shape.tool === 'pin' && <circle cx={start.x} cy={start.y} r={7} fill={MARK_COLOR} fillOpacity={selected ? 0.5 : 0.3} stroke={MARK_COLOR} strokeWidth={stroke} />}
      <circle cx={start.x} cy={start.y} r={9} fill={MARK_COLOR} />
      <text x={start.x} y={start.y} textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={700} fill="var(--theme-paper)">
        {label}
      </text>
    </g>
  );
}
