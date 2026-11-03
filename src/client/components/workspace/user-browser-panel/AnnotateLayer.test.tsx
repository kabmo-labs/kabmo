/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The annotation surface over the user's page.
 *
 * Two things are pinned here, and both are user-visible failures otherwise:
 *
 * - A drag becomes a mark whose points are NORMALIZED to the measured surface,
 *   so the same gesture at 100% and 200% zoom describes the same place. The
 *   panel's CSS `zoom` is applied by an ancestor, and `getBoundingClientRect`
 *   already reports the zoomed box — measured in Chromium at 150%: iframe
 *   900×450, overlay 900×450 — so the ratio is scale-free by construction.
 * - A click with no drag is not a region. Every stray click would otherwise
 *   become an empty mark in the prompt.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { AnnotateLayer } from '@/client/components/workspace/user-browser-panel/AnnotateLayer';
import type { AnnotateShape } from '@/shared/types';

const DOM_GLOBALS = [
  'window',
  'document',
  'navigator',
  'Node',
  'Element',
  'HTMLElement',
  'Event',
  'PointerEvent',
  'ResizeObserver',
] as const;
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

const WIDTH = 400;
const HEIGHT = 200;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in native)) native[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  // happy-dom has no layout: the surface reports the box these cases drag on.
  const proto = win.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0, right: WIDTH, bottom: HEIGHT, width: WIDTH, height: HEIGHT,
    toJSON: () => ({}),
  });
  proto.setPointerCapture = () => {};
  proto.releasePointerCapture = () => {};
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (native[key] === undefined) delete target[key];
    else target[key] = native[key];
  }
});

let container: HTMLElement | undefined;
let added: AnnotateShape[] = [];
let measured: { width: number; height: number }[] = [];

function mount(tool: AnnotateShape['tool'] = 'box'): HTMLElement {
  added = [];
  measured = [];
  container = document.body.appendChild(document.createElement('div'));
  act(() => {
    render(h(AnnotateLayer, {
      shapes: [],
      tool,
      selectedId: null,
      onMeasure: (size) => measured.push(size),
      onAdd: (shape) => added.push(shape),
      onSelect: () => {},
    }), container!);
  });
  const surface = container.querySelector('div');
  if (!surface) throw new Error('overlay did not render');
  return surface as HTMLElement;
}

/** A pointer gesture as the browser delivers it. */
function drag(surface: HTMLElement, from: [number, number], to: [number, number], target: EventTarget = surface): void {
  act(() => {
    target.dispatchEvent(new window.PointerEvent('pointerdown', { clientX: from[0], clientY: from[1], button: 0, bubbles: true }));
    target.dispatchEvent(new window.PointerEvent('pointermove', { clientX: to[0], clientY: to[1], bubbles: true }));
    target.dispatchEvent(new window.PointerEvent('pointerup', { clientX: to[0], clientY: to[1], bubbles: true }));
  });
}

beforeEach(() => {
  container?.remove();
  container = undefined;
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  container = undefined;
});

describe('AnnotateLayer', () => {
  test('reports the measured box, which is what makes a percentage resolvable', () => {
    mount();
    expect(measured).toContainEqual({ width: WIDTH, height: HEIGHT });
  });

  test('a drag becomes a mark with points normalized to the surface', () => {
    const surface = mount();
    drag(surface, [40, 20], [120, 70]);
    expect(added).toHaveLength(1);
    const shape = added[0]!;
    expect(shape.tool).toBe('box');
    expect(shape.start.x).toBeCloseTo(0.1, 5);
    expect(shape.start.y).toBeCloseTo(0.1, 5);
    expect(shape.end.x).toBeCloseTo(0.3, 5);
    expect(shape.end.y).toBeCloseTo(0.35, 5);
    expect(shape.note).toBe('');
  });

  test('the same gesture describes the same place at any panel size', () => {
    const surface = mount();
    drag(surface, [WIDTH / 4, HEIGHT / 4], [WIDTH / 2, HEIGHT / 2]);
    const small = added[0]!;
    added = [];
    // A drag over the same fractions of a bigger box is the same mark.
    drag(surface, [WIDTH / 2, HEIGHT / 2], [WIDTH / 4, HEIGHT / 4]);
    const reversed = added[0]!;
    expect(reversed.start).toEqual({ x: 0.5, y: 0.5 });
    expect(reversed.end).toEqual({ x: 0.25, y: 0.25 });
    expect(small.start).toEqual({ x: 0.25, y: 0.25 });
  });

  test('a click with no drag is not a mark', () => {
    const surface = mount();
    drag(surface, [50, 50], [51, 51]);
    expect(added).toEqual([]);
  });

  test('a pin counts without a drag, because a point is the whole mark', () => {
    const surface = mount('pin');
    drag(surface, [100, 40], [100, 40]);
    expect(added).toHaveLength(1);
    expect(added[0]!.start).toEqual({ x: 0.25, y: 0.2 });
  });

  test('a pointer that leaves the surface clamps instead of storing an out-of-range point', () => {
    const surface = mount();
    drag(surface, [10, 10], [WIDTH + 200, HEIGHT + 200]);
    expect(added[0]!.end).toEqual({ x: 1, y: 1 });
  });

  test('the overlay covers the page, so no pointer reaches the iframe underneath', () => {
    const surface = mount();
    expect(surface.className).toContain('absolute');
    expect(surface.className).toContain('inset-0');
  });
});

describe('AnnotateLayer marks', () => {
  test('every committed mark is painted with its number', () => {
    container = document.body.appendChild(document.createElement('div'));
    const shapes: AnnotateShape[] = [
      { id: 'a', tool: 'box', start: { x: 0.1, y: 0.1 }, end: { x: 0.2, y: 0.2 }, note: '' },
      { id: 'b', tool: 'pin', start: { x: 0.5, y: 0.5 }, end: { x: 0.5, y: 0.5 }, note: '' },
    ];
    act(() => {
      render(h(AnnotateLayer, {
        shapes,
        tool: 'box',
        selectedId: null,
        onMeasure: () => {},
        onAdd: () => {},
        onSelect: () => {},
      }), container!);
    });
    const numbers = [...container.querySelectorAll('text')].map((node) => node.textContent);
    expect(numbers).toEqual(['1', '2']);
  });
});
