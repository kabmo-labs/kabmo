/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The user-browser panel's annotation geometry, and the words a mark becomes.
 *
 * A mark on that panel can only ever be GEOMETRY. The panel renders the user's
 * page in a cross-origin iframe, so the host document cannot read the page
 * (measured in Chromium: `contentDocument` is `null`, `drawImage(iframeElem)`
 * throws `TypeError` because an iframe is not a `CanvasImageSource`, and a
 * region read through `elementFromPoint` throws `SecurityError`). Both browser
 * panels therefore hand the agent a description of WHERE, never a picture —
 * which is also how the tools in this class work (Ghostex's Annotate is
 * Agentation: element paths, bounding boxes and stroke descriptions, no
 * screenshot).
 *
 * Every point is normalized to 0..1 against the measured panel box, so a mark
 * survives a zoom change, a viewport-preset change and a panel resize. The
 * panel box itself travels beside the marks (`AnnotatePanelSize`), because a
 * percentage of 1024px and a percentage of 375px are different places.
 */

import type { AnnotateElement, AnnotatePanelSize, AnnotatePoint, AnnotateShape, AnnotateTool } from '@/shared/types';

/** Panel box a pointer position is normalized against. */
export interface AnnotateRect {
  width: number;
  height: number;
}

/** Clamp a pointer position into the panel and express it as 0..1. */
export function normalizePoint(rect: AnnotateRect, client: AnnotatePoint): AnnotatePoint {
  if (!(rect.width > 0) || !(rect.height > 0)) return { x: 0, y: 0 };
  return {
    x: clamp01(client.x / rect.width),
    y: clamp01(client.y / rect.height),
  };
}

/** A ratio as a 0..1 fraction; `NaN` becomes 0 rather than poisoning the shape. */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** A shape's bounding box in normalized units, whichever way it was dragged. */
export function shapeRegion(shape: Pick<AnnotateShape, 'start' | 'end'>): { x: number; y: number; width: number; height: number } {
  const x = Math.min(shape.start.x, shape.end.x);
  const y = Math.min(shape.start.y, shape.end.y);
  return {
    x,
    y,
    width: Math.abs(shape.end.x - shape.start.x),
    height: Math.abs(shape.end.y - shape.start.y),
  };
}

/** Whether a mark carries anything worth sending (a click with no drag still counts). */
export function isUsableShape(shape: Pick<AnnotateShape, 'start' | 'end' | 'note'> & { label?: string; element?: unknown }): boolean {
  if (shape.note.trim().length > 0) return true;
  if ((shape.label ?? '').trim().length > 0) return true;
  if (shape.element) return true;
  const region = shapeRegion(shape);
  return region.width > 0.005 || region.height > 0.005;
}

export const ANNOTATE_TOOL_LABEL: Record<AnnotateTool, string> = {
  box: 'kotak',
  pin: 'titik',
  arrow: 'panah',
};

/**
 * The regions a user reaches for most, offered as chips so naming a mark costs
 * one click instead of typing.
 *
 * A fixed vocabulary, NOT a guess from the page: the panel's frame is
 * cross-origin in the normal case, so the only entity that knows this page has
 * a "modal" is the person looking at it.
 */
export const ANNOTATE_LABEL_SUGGESTIONS = [
  'header',
  'nav',
  'konten',
  'form',
  'tabel',
  'daftar',
  'modal',
  'sidebar',
  'footer',
] as const;

/** `bagian "Ringkasan pesanan"` for a named mark, nothing for an unnamed one. */
function labelPrefix(label: string | undefined): string {
  const name = label?.trim();
  return name ? `bagian "${name}" — ` : '';
}

/** What the mark sits on, when the frame was readable. */
function elementSuffix(element: AnnotateShape['element']): string {
  if (!element) return '';
  const facts = [element.path];
  if (element.role) facts.push(`role ${element.role}`);
  if (element.state) facts.push(element.state);
  if (element.text) facts.push(`teks "${element.text}"`);
  return ` [elemen: ${facts.join(' · ')}]`;
}

/** `12.0%` — one decimal, which is precise enough to re-find a spot by hand. */
function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** CSS px for a normalized length, so the agent can see the real size. */
function px(value: number, extent: number): number {
  return Math.round(value * extent);
}

/**
 * One mark as a sentence the agent can act on.
 *
 * The px pair is the point of having the panel size at all: "a 120×38 box at
 * 26%,44%" tells the agent the button's real size, while the percentage alone
 * only tells it a ratio.
 */
export function describeShape(
  shape: AnnotateShape,
  index: number,
  panel: { width: number; height: number },
): string {
  const where = `(${percent(shape.start.x)}, ${percent(shape.start.y)})`;
  const spot = `(${px(shape.start.x, panel.width)}×${px(shape.start.y, panel.height)} px)`;
  const tool = ANNOTATE_TOOL_LABEL[shape.tool];
  const head = `${index}. ${labelPrefix(shape.label)}${tool}`;
  const note = shape.note.trim();
  const tail = note.length > 0 ? ` — ${note}` : '';
  const element = elementSuffix(shape.element);

  if (shape.tool === 'pin') return `${head} di ${where} ${spot}${element}${tail}`;
  if (shape.tool === 'arrow') {
    const to = `(${percent(shape.end.x)}, ${percent(shape.end.y)})`;
    return `${head} ${where} → ${to}${element}${tail}`;
  }
  const region = shapeRegion(shape);
  const size = `lebar ${percent(region.width)}, tinggi ${percent(region.height)}`;
  const pixels = `(${px(region.width, panel.width)}×${px(region.height, panel.height)} px)`;
  return `${head} kiri ${percent(region.x)}, atas ${percent(region.y)}, ${size} ${pixels}${element}${tail}`;
}

/** Every usable mark, described and numbered from 1 in draw order. */
export function describeAnnotations(
  shapes: readonly AnnotateShape[],
  panel: { width: number; height: number },
): string[] {
  return shapes
    .filter(isUsableShape)
    .map((shape, index) => describeShape(shape, index + 1, panel));
}

const TOOLS: readonly AnnotateTool[] = ['box', 'pin', 'arrow'];

function readTool(value: unknown): AnnotateTool | null {
  return typeof value === 'string' && (TOOLS as readonly string[]).includes(value) ? (value as AnnotateTool) : null;
}

function readPoint(value: unknown): AnnotatePoint | null {
  if (!value || typeof value !== 'object') return null;
  const { x, y } = value as { x?: unknown; y?: unknown };
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: clamp01(x), y: clamp01(y) };
}

/** A marked element's facts, kept only in the shapes the formatter can print. */
function readElement(value: unknown): AnnotateElement | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.path !== 'string' || !record.path) return null;
  if (typeof record.tag !== 'string' || !record.tag) return null;
  const element: AnnotateElement = { path: record.path, tag: record.tag };
  if (typeof record.role === 'string' && record.role) element.role = record.role;
  if (typeof record.text === 'string' && record.text) element.text = record.text;
  if (typeof record.state === 'string' && record.state) element.state = record.state;
  return element;
}

/**
 * The marks from a DOM event's detail, dropping anything malformed.
 *
 * The detail crosses a CustomEvent from another panel, so it is untrusted input
 * even when both ends are ours: a shape with a string where a number belongs
 * would otherwise reach the formatter and render `NaN%` into the prompt.
 */
export function readAnnotationShapes(value: unknown): AnnotateShape[] | null {
  if (!Array.isArray(value)) return null;
  const shapes: AnnotateShape[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const tool = readTool(record.tool);
    const start = readPoint(record.start);
    const end = readPoint(record.end);
    if (!tool || !start || !end) continue;
    const id = typeof record.id === 'string' && record.id ? record.id : `annot-${shapes.length + 1}`;
    const note = typeof record.note === 'string' ? record.note : '';
    const label = typeof record.label === 'string' ? record.label : '';
    const element = readElement(record.element);
    shapes.push({ id, tool, start, end, label, note, ...(element ? { element } : {}) });
  }
  return shapes.length > 0 ? shapes : null;
}

/** The panel box from a DOM event's detail, or null when it is not a usable box. */
export function readAnnotatePanel(value: unknown): AnnotatePanelSize | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const width = record.width;
  const height = record.height;
  if (typeof width !== 'number' || typeof height !== 'number') return null;
  if (!(width > 0) || !(height > 0)) return null;
  return {
    width,
    height,
    viewportMode: typeof record.viewportMode === 'string' ? record.viewportMode : 'responsive',
    zoom: typeof record.zoom === 'number' && Number.isFinite(record.zoom) ? record.zoom : 100,
  };
}
