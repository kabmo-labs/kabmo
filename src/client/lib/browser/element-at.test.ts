/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Reading the element under a mark.
 *
 * Two rules are pinned here, and they are the ones that keep the panel honest:
 *
 * - A cross-origin frame answers a REASON, never an element and never a blank.
 *   Measured in Chromium, `127.0.0.1:7101` embedding `127.0.0.1:7102` reports
 *   `contentDocument === null`; the same origin reports a live document.
 * - A `<select>` reports its CHOSEN VALUE and option count. That is the fact a
 *   screenshot cannot give an agent and a user would have to type out — and it
 *   is why the user-browser panel asks for elements at all.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import { describeElement, elementAtPoint, elementPath, frameReadability } from '@/client/lib/browser/element-at';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLSelectElement'] as const;
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let win: Window;
/**
 * The fixture document, typed as the runner's `lib.dom` `Document`.
 *
 * The cast is the whole point of the harness: happy-dom's `Document` is a
 * different type from `lib.dom`'s (it lacks `currentCSSZoom`, `part` and the
 * rest), while at runtime it is the object `highlight` reads. Typing it as
 * happy-dom's own class would force every `createElement` result through a
 * second cast.
 */
let doc: Document;

beforeAll(() => {
  win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in native)) native[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (native[key] === undefined) delete target[key];
    else target[key] = native[key];
  }
});

/** A readable iframe: its `contentDocument` IS the fixture document. */
function readableFrame(): HTMLIFrameElement {
  return { contentDocument: doc, contentWindow: win } as unknown as HTMLIFrameElement;
}

/** A frame whose document this origin cannot touch — the real production case. */
function crossOriginFrame(): HTMLIFrameElement {
  return { contentDocument: null, contentWindow: null } as unknown as HTMLIFrameElement;
}

beforeEach(() => {
  doc = win.document as unknown as Document;
  doc.body.innerHTML = '';
  // happy-dom has no layout, so the frame's viewport is stated and
  // `elementFromPoint` is answered from the point these cases aim at.
  Object.defineProperty(win, 'innerWidth', { value: 1000, configurable: true });
  Object.defineProperty(win, 'innerHeight', { value: 500, configurable: true });
});

/** Make `elementFromPoint` answer whatever sits at the given fractions. */
function hitAt(fractions: { x: number; y: number }, element: Element | null): { asked: string[] } {
  const asked: string[] = [];
  (doc as unknown as Record<string, unknown>).elementFromPoint = (x: number, y: number) => {
    asked.push(`${x},${y}`);
    const matchesX = Math.abs(x - fractions.x * 1000) < 1;
    const matchesY = Math.abs(y - fractions.y * 500) < 1;
    return matchesX && matchesY ? element : null;
  };
  return { asked };
}

describe('frameReadability', () => {
  test('a live document is readable', () => {
    expect(frameReadability(readableFrame())).toBe('readable');
  });

  test('a null document is cross-origin, not an error', () => {
    expect(frameReadability(crossOriginFrame())).toBe('cross-origin');
  });

  test('a frame that throws while being read is treated as cross-origin', () => {
    const trap = Object.defineProperty({}, 'contentDocument', {
      get() {
        throw new Error('SecurityError');
      },
    }) as unknown as HTMLIFrameElement;
    expect(frameReadability(trap)).toBe('cross-origin');
  });

  test('no frame at all is its own reason', () => {
    expect(frameReadability(null)).toBe('no-frame');
  });
});

describe('elementAtPoint', () => {
  test('a cross-origin frame answers a reason and never guesses an element', () => {
    const result = elementAtPoint(crossOriginFrame(), { x: 0.5, y: 0.5 });
    expect(result).toEqual({ ok: false, reason: 'cross-origin' });
  });

  test('a mark over empty space is no-element, which is not the same fact', () => {
    hitAt({ x: 0.5, y: 0.5 }, null);
    expect(elementAtPoint(readableFrame(), { x: 0.5, y: 0.5 })).toEqual({ ok: false, reason: 'no-element' });
  });

  test('the marked point maps onto the FRAME viewport, not the panel box', () => {
    const button = doc.createElement('button');
    button.id = 'pay';
    doc.body.appendChild(button);
    const probe = hitAt({ x: 0.25, y: 0.4 }, button);
    const result = elementAtPoint(readableFrame(), { x: 0.25, y: 0.4 });
    expect(result.ok).toBe(true);
    // 25% of a 1000px viewport, 40% of a 500px one.
    expect(probe.asked).toEqual(['250,200']);
  });

  test('a section reports its aria-label in the path', () => {
    const section = doc.createElement('section');
    section.setAttribute('aria-label', 'Ringkasan pesanan');
    doc.body.appendChild(section);
    hitAt({ x: 0.5, y: 0.5 }, section);
    const result = elementAtPoint(readableFrame(), { x: 0.5, y: 0.5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.element.path).toContain('section[aria-label="Ringkasan pesanan"]');
    expect(result.element.tag).toBe('section');
  });

  test('a select reports its chosen value and option count', () => {
    const select = doc.createElement('select');
    select.id = 'prov';
    for (const name of ['Aceh', 'Jawa Barat', 'Bali']) {
      const option = doc.createElement('option');
      option.value = name.toLowerCase();
      option.textContent = name;
      select.appendChild(option);
    }
    select.value = 'jawa barat';
    doc.body.appendChild(select);
    hitAt({ x: 0.3, y: 0.3 }, select);
    const result = elementAtPoint(readableFrame(), { x: 0.3, y: 0.3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.element.tag).toBe('select');
    expect(result.element.state).toContain('nilai "Jawa Barat"');
    expect(result.element.state).toContain('3 opsi');
  });

  test('a disabled control says so, which is the bug users report most', () => {
    const button = doc.createElement('button');
    button.textContent = 'Bayar';
    button.setAttribute('disabled', '');
    doc.body.appendChild(button);
    hitAt({ x: 0.5, y: 0.5 }, button);
    const result = elementAtPoint(readableFrame(), { x: 0.5, y: 0.5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.element.state).toContain('nonaktif');
    expect(result.element.text).toBe('Bayar');
  });

  test('a password input never reports its value', () => {
    const input = doc.createElement('input');
    input.type = 'password';
    input.value = 'rahasia-sekali';
    doc.body.appendChild(input);
    hitAt({ x: 0.5, y: 0.5 }, input);
    const result = elementAtPoint(readableFrame(), { x: 0.5, y: 0.5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result.element)).not.toContain('rahasia-sekali');
    expect(result.element.state).toContain('tipe password');
  });

  test('body and html are not "an element under the mark"', () => {
    hitAt({ x: 0.5, y: 0.5 }, doc.body);
    expect(elementAtPoint(readableFrame(), { x: 0.5, y: 0.5 })).toEqual({ ok: false, reason: 'no-element' });
  });
});

describe('elementPath', () => {
  test('keeps at most four levels and stops at html', () => {
    const outer = doc.createElement('main');
    const middle = doc.createElement('section');
    const inner = doc.createElement('div');
    const leaf = doc.createElement('button');
    inner.appendChild(leaf);
    middle.appendChild(inner);
    outer.appendChild(middle);
    doc.body.appendChild(outer);
    const path = elementPath(leaf);
    expect(path.split(' > ')).toHaveLength(4);
    expect(path.endsWith('button')).toBe(true);
    expect(path).not.toContain('html');
  });

  test('an id wins over a tag alone', () => {
    const node = doc.createElement('div');
    node.id = 'cart';
    doc.body.appendChild(node);
    expect(elementPath(node)).toContain('div#cart');
  });
});

describe('describeElement', () => {
  test('collapses whitespace and cuts long text', () => {
    const node = doc.createElement('p');
    node.textContent = `  ${'kata '.repeat(40)}  `;
    doc.body.appendChild(node);
    const info = describeElement(node);
    expect(info.text?.length).toBeLessThanOrEqual(60);
    expect(info.text?.startsWith('kata kata')).toBe(true);
  });
});
