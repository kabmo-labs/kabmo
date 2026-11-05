/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Annotation geometry and prompt text.
 *
 * The failure these cases exist for is a prompt that sends a mark the agent
 * cannot resolve. A percentage alone does not survive: 12% of a 1024px panel
 * and 12% of a 375px panel are different places, and a mark dragged
 * bottom-right-to-top-left has to describe the same box as one dragged the
 * other way. Measured geometry, not rounded pixels, is what the agent re-opens
 * the page with.
 */

import { describe, expect, test } from 'bun:test';

import { clamp01, describeAnnotations, describeShape, isUsableShape, normalizePoint, readAnnotatePanel, readAnnotationShapes, shapeRegion } from '@/shared/lib/browser/annotate';
import { appendPageContext, formatPageContextBlock } from '@/shared/lib/browser/page-context';
import type { AnnotateShape } from '@/shared/types';

const PANEL = { width: 1024, height: 768 };

function shape(overrides: Partial<AnnotateShape> = {}): AnnotateShape {
  return {
    id: 'a1',
    tool: 'box',
    start: { x: 0.1, y: 0.2 },
    end: { x: 0.3, y: 0.35 },
    label: '',
    note: '',
    ...overrides,
  };
}

describe('normalizePoint', () => {
  test('expresses a pointer position as a fraction of the measured box', () => {
    expect(normalizePoint(PANEL, { x: 256, y: 384 })).toEqual({ x: 0.25, y: 0.5 });
  });

  test('clamps a drag that leaves the panel instead of storing an out-of-range point', () => {
    expect(normalizePoint(PANEL, { x: -40, y: 900 })).toEqual({ x: 0, y: 1 });
  });

  test('an unmeasured panel answers a zero point rather than NaN', () => {
    expect(normalizePoint({ width: 0, height: 0 }, { x: 10, y: 10 })).toEqual({ x: 0, y: 0 });
  });
});

describe('clamp01', () => {
  test('keeps a fraction, clamps the ends and refuses a non-number', () => {
    expect([clamp01(0.42), clamp01(-1), clamp01(2), clamp01(Number.NaN)]).toEqual([0.42, 0, 1, 0]);
  });
});

describe('shapeRegion', () => {
  test('a box dragged bottom-right to top-left has the same region as one dragged forward', () => {
    const forward = shapeRegion({ start: { x: 0.1, y: 0.2 }, end: { x: 0.3, y: 0.35 } });
    const backward = shapeRegion({ start: { x: 0.3, y: 0.35 }, end: { x: 0.1, y: 0.2 } });
    expect(backward).toEqual(forward);
    expect(forward.x).toBeCloseTo(0.1, 6);
    expect(forward.width).toBeCloseTo(0.2, 6);
  });
});

describe('isUsableShape', () => {
  test('a click with no drag is not a mark', () => {
    expect(isUsableShape({ start: { x: 0.5, y: 0.5 }, end: { x: 0.5, y: 0.5 }, note: '' })).toBe(false);
  });

  test('a note makes even a bare click worth sending', () => {
    expect(isUsableShape({ start: { x: 0.5, y: 0.5 }, end: { x: 0.5, y: 0.5 }, note: 'tombol mati' })).toBe(true);
  });

  test('a dragged region counts without a note', () => {
    expect(isUsableShape(shape())).toBe(true);
  });
});

describe('describeShape', () => {
  test('a box states the region in percent AND the pixel size the panel size makes resolvable', () => {
    expect(describeShape(shape({ note: 'total harga terpotong' }), 1, PANEL))
      .toBe('1. box left 10.0%, top 20.0%, width 20.0%, height 15.0% (205×115 px): total harga terpotong');
  });

  test('a pin states one point, an arrow states where it points', () => {
    expect(describeShape(shape({ tool: 'pin', note: 'badge salah' }), 2, PANEL))
      .toBe('2. pin at (10.0%, 20.0%) (102×154 px): badge salah');
    expect(describeShape(shape({ tool: 'arrow', end: { x: 0.72, y: 0.185 } }), 3, PANEL))
      .toBe('3. arrow (10.0%, 20.0%) → (72.0%, 18.5%)');
  });

  test('a mark with no note ends at the geometry, with no dangling separator', () => {
    expect(describeShape(shape(), 1, PANEL).endsWith('px)')).toBe(true);
  });
});

describe('describeAnnotations', () => {
  test('numbers from 1 in draw order and drops the unusable marks', () => {
    const lines = describeAnnotations([
      shape({ id: 'a', note: 'satu' }),
      shape({ id: 'b', start: { x: 0.5, y: 0.5 }, end: { x: 0.5, y: 0.5 } }),
      shape({ id: 'c', tool: 'pin', start: { x: 0.9, y: 0.1 }, end: { x: 0.9, y: 0.1 }, note: 'tiga' }),
    ], PANEL);
    expect(lines).toHaveLength(2);
    expect(lines[0]?.startsWith('1. box')).toBe(true);
    expect(lines[1]?.startsWith('2. pin')).toBe(true);
  });
});

describe('readAnnotationShapes', () => {
  test('keeps a well-formed mark', () => {
    expect(readAnnotationShapes([shape()])).toEqual([shape()]);
  });

  test('drops a mark whose points are not numbers, instead of rendering NaN%', () => {
    expect(readAnnotationShapes([{ id: 'x', tool: 'box', start: { x: 'a', y: 0 }, end: { x: 1, y: 1 } }])).toBeNull();
  });

  test('drops an unknown tool', () => {
    expect(readAnnotationShapes([{ id: 'x', tool: 'lasso', start: { x: 0, y: 0 }, end: { x: 1, y: 1 } }])).toBeNull();
  });

  test('clamps points that arrive outside the panel', () => {
    const parsed = readAnnotationShapes([{ id: 'x', tool: 'pin', start: { x: -5, y: 9 }, end: { x: -5, y: 9 } }]);
    expect(parsed?.[0]?.start).toEqual({ x: 0, y: 1 });
  });

  test('a non-array is not a mark list', () => {
    expect(readAnnotationShapes('nope')).toBeNull();
  });
});

describe('readAnnotatePanel', () => {
  test('reads a measured box', () => {
    expect(readAnnotatePanel({ width: 1024, height: 768, viewportMode: 'laptop', zoom: 150 }))
      .toEqual({ width: 1024, height: 768, viewportMode: 'laptop', zoom: 150 });
  });

  test('an unmeasured box is refused, because percentages against it mean nothing', () => {
    expect(readAnnotatePanel({ width: 0, height: 400 })).toBeNull();
  });

  test('missing optional fields fall back to a responsive, unzoomed panel', () => {
    expect(readAnnotatePanel({ width: 10, height: 20 })).toEqual({ width: 10, height: 20, viewportMode: 'responsive', zoom: 100 });
  });
});

describe('formatPageContextBlock', () => {
  test('a page with no marks keeps the shape the panel has always produced', () => {
    expect(formatPageContextBlock({ url: 'https://a.test/x', title: 'A' })).toBe([
      '[Browser page context]',
      'URL: https://a.test/x',
      'Title: A',
      '(Continue from this page.)',
    ].join('\n'));
  });

  test('marks add a numbered list, the panel shape, and the user-only warning', () => {
    const block = formatPageContextBlock({
      url: 'http://localhost:5173/checkout',
      panel: { width: 1024, height: 768, viewportMode: 'laptop', zoom: 100 },
      annotations: [shape({ note: 'tombol Bayar nonaktif' })],
    });
    expect(block).toContain('Panel: laptop 1024×768 px @100%');
    expect(block).toContain('Annotations (1):\n1. box');
    expect(block).toContain('Only the user can see this page');
  });

  test('a panel size with only unusable marks sends no annotation section at all', () => {
    const block = formatPageContextBlock({
      url: 'https://a.test',
      panel: { width: 100, height: 100, viewportMode: 'responsive', zoom: 100 },
      annotations: [shape({ start: { x: 0.4, y: 0.4 }, end: { x: 0.4, y: 0.4 } })],
    });
    expect(block).not.toContain('Annotations');
  });
});

describe('appendPageContext', () => {
  test('a blank draft receives the block alone', () => {
    expect(appendPageContext('', { url: 'https://a.test' }).startsWith('[Browser page context]')).toBe(true);
  });

  test('existing text is separated by exactly one blank line', () => {
    expect(appendPageContext('halo', { url: 'https://a.test' })).toBe(
      'halo\n\n[Browser page context]\nURL: https://a.test\n(Continue from this page.)',
    );
  });

  test('a draft already ending in a blank line does not gain a third', () => {
    expect(appendPageContext('halo\n\n', { url: 'https://a.test' })).toContain('halo\n\n[Browser');
    expect(appendPageContext('halo\n\n', { url: 'https://a.test' })).not.toContain('halo\n\n\n');
  });
});

describe('label on a mark', () => {
  test('a named region leads the line, so the agent knows WHAT before WHERE', () => {
    expect(describeShape(shape({ label: 'Ringkasan pesanan', note: 'total terpotong' }), 1, PANEL))
      .toBe('1. part "Ringkasan pesanan": box left 10.0%, top 20.0%, width 20.0%, height 15.0% (205×115 px): total terpotong');
  });

  test('an unnamed mark keeps exactly the line it produced before labels existed', () => {
    expect(describeShape(shape(), 1, PANEL))
      .toBe('1. box left 10.0%, top 20.0%, width 20.0%, height 15.0% (205×115 px)');
  });

  test('a label alone makes a zero-size mark worth sending', () => {
    expect(isUsableShape({ start: { x: 0.5, y: 0.5 }, end: { x: 0.5, y: 0.5 }, note: '', label: 'modal' })).toBe(true);
  });

  test('a whitespace-only label is not a name', () => {
    expect(isUsableShape({ start: { x: 0.5, y: 0.5 }, end: { x: 0.5, y: 0.5 }, note: '', label: '   ' })).toBe(false);
  });
});

describe('element on a mark', () => {
  const select = {
    path: 'section[aria-label="Ringkasan"] > form > select#prov',
    tag: 'select',
    state: 'nilai "Jawa Barat", 5 opsi',
    text: 'Provinsi',
  };

  test('a readable element adds its path, state and text after the geometry', () => {
    const line = describeShape(shape({ element: select }), 1, PANEL);
    expect(line).toContain('[element: section[aria-label="Ringkasan"] > form > select#prov');
    expect(line).toContain('nilai "Jawa Barat", 5 opsi');
    expect(line).toContain('text "Provinsi"');
    // The note still ends the line, after the element facts.
    expect(line.endsWith('px) [element:')).toBe(false);
  });

  test('an unreadable mark says nothing about elements rather than printing an empty one', () => {
    expect(describeShape(shape(), 1, PANEL)).not.toContain('elemen');
  });

  test('role is stated when the element declares one', () => {
    const line = describeShape(shape({ element: { path: 'div > div', tag: 'div', role: 'dialog' } }), 2, PANEL);
    expect(line).toContain('role dialog');
  });
});

describe('readAnnotationShapes with the new fields', () => {
  test('carries label and element through', () => {
    const parsed = readAnnotationShapes([{
      id: 'a', tool: 'pin', start: { x: 0.2, y: 0.3 }, end: { x: 0.2, y: 0.3 },
      label: 'form', note: 'kosong',
      element: { path: 'body > form', tag: 'form', state: 'nonaktif' },
    }]);
    expect(parsed?.[0]?.label).toBe('form');
    expect(parsed?.[0]?.element).toEqual({ path: 'body > form', tag: 'form', state: 'nonaktif' });
  });

  test('a malformed element is dropped, and the mark survives with its label', () => {
    const parsed = readAnnotationShapes([{
      id: 'a', tool: 'pin', start: { x: 0.2, y: 0.3 }, end: { x: 0.2, y: 0.3 },
      label: 'form', note: '',
      element: { path: '', tag: 'form' },
    }]);
    expect(parsed?.[0]?.element).toBeUndefined();
    expect(parsed?.[0]?.label).toBe('form');
  });
});

describe('viewport resolution hint', () => {
  const base = {
    url: 'https://a.test',
    panel: { width: 276, height: 620, viewportMode: 'laptop', zoom: 110 },
    annotations: [shape({ note: 'mati' })],
  };

  test('the block states the viewport the coordinates are fractions of', () => {
    const block = formatPageContextBlock(base);
    expect(block).toContain('Coordinates are relative to a 276×620 px viewport');
    expect(block).toContain('look for the element at that point');
  });

  test('the hint belongs to an annotated page, not to a plain one', () => {
    expect(formatPageContextBlock({ url: 'https://a.test' })).not.toContain('Coordinates are relative');
  });
});
