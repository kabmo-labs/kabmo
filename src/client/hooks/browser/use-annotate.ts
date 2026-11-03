/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Annotating the user-browser panel.
 *
 * The marks belong to ONE page view. An iframe's internal navigation is not
 * observable from this origin (`onLoad` is all the host gets), so a mark made
 * before a navigation would otherwise point at a different document than the
 * one it was drawn on. `frameKey` therefore clears the marks: a reload or a
 * typed address is a new page, and keeping them would send the agent
 * coordinates for a page the user is no longer looking at.
 *
 * The mark being DRAGGED is not state here — it lives in the overlay that draws
 * it, and arrives as one finished shape through `add`. A pointermove-driven
 * value in this hook would re-render the panel (iframe included) on every move.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import type { AnnotateShape, AnnotateTool } from '@/shared/types';

export interface UseAnnotateResult {
  active: boolean;
  tool: AnnotateTool;
  shapes: AnnotateShape[];
  /** The mark whose note field is open, if any. */
  selectedId: string | null;
  setTool: (tool: AnnotateTool) => void;
  toggle: () => void;
  close: () => void;
  /** Commit one finished mark and open its note field. */
  add: (shape: AnnotateShape) => void;
  setNote: (id: string, note: string) => void;
  select: (id: string | null) => void;
  remove: (id: string) => void;
  reset: () => void;
}

let shapeSeq = 0;

/** Ids are unique per mark; the overlay stamps one when the drag starts. */
export function nextShapeId(): string {
  shapeSeq += 1;
  return `annot-${Date.now().toString(36)}-${shapeSeq}`;
}

export function useAnnotate(frameKey: number): UseAnnotateResult {
  const [active, setActive] = useState(false);
  const [tool, setTool] = useState<AnnotateTool>('box');
  const [shapes, setShapes] = useState<AnnotateShape[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // A new page invalidates every mark on the old one.
  useEffect(() => {
    setShapes([]);
    setSelectedId(null);
  }, [frameKey]);

  const toggle = useCallback(() => {
    setActive((prev) => !prev);
    setSelectedId(null);
  }, []);

  const close = useCallback(() => {
    setSelectedId(null);
    setActive(false);
  }, []);

  const add = useCallback((shape: AnnotateShape) => {
    setShapes((prev) => [...prev, shape]);
    // A finished mark is the one the user is about to describe.
    setSelectedId(shape.id);
  }, []);

  const setNote = useCallback((id: string, note: string) => {
    setShapes((prev) => prev.map((shape) => (shape.id === id ? { ...shape, note } : shape)));
  }, []);

  const remove = useCallback((id: string) => {
    setShapes((prev) => prev.filter((shape) => shape.id !== id));
    setSelectedId((current) => (current === id ? null : current));
  }, []);

  const reset = useCallback(() => {
    setShapes([]);
    setSelectedId(null);
  }, []);

  return { active, tool, shapes, selectedId, setTool, toggle, close, add, setNote, select: setSelectedId, remove, reset };
}
