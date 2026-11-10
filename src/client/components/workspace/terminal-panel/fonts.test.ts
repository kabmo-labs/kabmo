/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { afterEach, describe, expect, test } from 'bun:test';
import {
  measureTerminalCell,
  waitForTerminalFonts,
  watchTerminalFonts,
} from '@/client/components/workspace/terminal-panel/fonts';

type LoadingListener = (event: { fontfaces: { family: string }[] }) => void;

interface FakeFonts {
  load: (font: string, text?: string) => Promise<unknown>;
  addEventListener: (_type: string, listener: LoadingListener) => void;
  removeEventListener: (_type: string, listener: LoadingListener) => void;
}

function installFakeDocument(): { fonts: FakeFonts; listeners: Set<LoadingListener> } {
  const listeners = new Set<LoadingListener>();
  const fonts: FakeFonts = {
    load: async () => [],
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
  // Bun has no DOM; install the one object the helpers read.
  const host = globalThis as unknown as { document?: unknown };
  host.document = { fonts };
  return { fonts, listeners };
}

afterEach(() => {
  const host = globalThis as unknown as { document?: unknown };
  delete host.document;
});

describe('waitForTerminalFonts', () => {
  test('loads the text face only, so the bundled symbols face stays lazy', async () => {
    const { fonts } = installFakeDocument();
    const calls: { font: string; text?: string }[] = [];
    fonts.load = async (font, text) => {
      calls.push({ font, ...(text ? { text } : {}) });
      return [];
    };

    await waitForTerminalFonts();

    expect(calls).toEqual([{ font: '12px "Fira Code"' }]);
    expect(calls.some((call) => call.font.includes('Kabmo Nerd Symbols'))).toBe(false);
  });

  test('a face that fails to load does not keep the terminal closed', async () => {
    const { fonts } = installFakeDocument();
    fonts.load = async () => {
      throw new Error('offline');
    };

    expect(await waitForTerminalFonts()).toBeUndefined();
  });
});

describe('watchTerminalFonts', () => {
  test('calls back only for a terminal face', () => {
    const { listeners } = installFakeDocument();
    let loaded = 0;
    const dispose = watchTerminalFonts(() => {
      loaded += 1;
    });

    for (const listener of listeners) listener({ fontfaces: [{ family: 'Inter' }] });
    expect(loaded).toBe(0);

    for (const listener of listeners) listener({ fontfaces: [{ family: '"Fira Code"' }] });
    expect(loaded).toBe(1);

    dispose();
    expect(listeners.size).toBe(0);
  });
});

describe('measureTerminalCell', () => {
  interface Box {
    advance: number;
    /** Ink of `Mg`. */
    ascent: number;
    descent: number;
    /** The font's own line box, as `fontBoundingBox*` reports it. */
    lineAscent: number;
    lineDescent: number;
  }

  function installFakeCanvas(box: Box): { fonts: unknown } {
    const host = globalThis as unknown as { document?: unknown };
    const context = {
      font: '',
      measureText: (text: string) => {
        const descent = text === 'Mg' ? box.descent : 0;
        return {
          width: box.advance,
          actualBoundingBoxAscent: box.ascent,
          actualBoundingBoxDescent: descent,
          fontBoundingBoxAscent: box.lineAscent,
          fontBoundingBoxDescent: box.lineDescent,
        };
      },
    };
    host.document = { fonts: {}, createElement: () => ({ getContext: () => context }) };
    return { fonts: {} };
  }

  // Fira Code at 12 px, measured in Chromium: an `M` advance of 7.2, an `Mg`
  // ink of 8.26 above and 2.54 below the baseline, and a line box of 12 + 4.
  const FIRA_CODE_12: Box = {
    advance: 7.2,
    ascent: 8.26,
    descent: 2.54,
    lineAscent: 12,
    lineDescent: 4,
  };

  test('pads the ink 2.5 px above and 1 px below', () => {
    installFakeCanvas(FIRA_CODE_12);

    const cell = measureTerminalCell(12, "'Fira Code'");

    // The cell is the paintable advance rounded up, not the font size.
    expect(cell.width).toBe(8);
    // 11 px of ink + 2.5 + 1, rounded up: a cell built from `M` alone was the
    // reported bug — the descender ended on the cell's last pixel and the next
    // row clipped it.
    expect(cell.height).toBe(15);
    const above = cell.baseline - FIRA_CODE_12.ascent;
    const below = cell.height - cell.baseline - FIRA_CODE_12.descent;
    expect(Math.abs(above - 2.5)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(below - 1)).toBeLessThanOrEqual(0.5);
  });

  test('never lets ink exceed the cell when it reaches past the line box', () => {
    // A face whose `g` hangs lower than its `fontBoundingBox` says it should.
    const box: Box = { advance: 7.2, ascent: 9, descent: 6, lineAscent: 10, lineDescent: 2 };
    installFakeCanvas(box);

    const cell = measureTerminalCell(12, "'Fira Code'");

    expect(cell.height).toBeGreaterThanOrEqual(Math.ceil(box.ascent + box.descent) + 4);
    expect(cell.baseline - box.ascent).toBeGreaterThanOrEqual(1);
    expect(cell.height - cell.baseline - box.descent).toBeGreaterThanOrEqual(1);
  });

  test('answers a usable box when there is no DOM', () => {
    const host = globalThis as unknown as { document?: unknown };
    delete host.document;

    const cell = measureTerminalCell(12, "'Fira Code'");

    expect(cell.width).toBeGreaterThan(0);
    expect(cell.height).toBeGreaterThan(cell.baseline);
  });
});
