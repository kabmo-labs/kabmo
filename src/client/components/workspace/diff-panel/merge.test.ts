/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The diff's hunk stepper: the two numbers the toolbar prints, and the move
 * behind the two chevrons.
 *
 * Every way this fails is silent. `getChunks` is a FUNCTION on the state and
 * answers `null` without a merge extension, so a wrong call reads as "no
 * changes" — and the merge package's own `goToNextChunk` moves the SELECTION
 * without scrolling, which on a read-only reader means the row changes somewhere
 * off screen. Both cases mount a real view.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import { mountSplitDiff, mountUnifiedDiff, type DiffViewHandle } from '@/client/components/workspace/diff-panel/merge';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const EXTRA_GLOBALS = ['MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver'] as const;
const native: Partial<Record<(typeof EXTRA_GLOBALS)[number], unknown>> = {};

let host: HTMLElement;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  installDomGlobals(win);
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of EXTRA_GLOBALS) {
    native[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  host = document.body.appendChild(document.createElement('div'));
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of EXTRA_GLOBALS) {
    if (native[key] === undefined) delete target[key];
    else target[key] = native[key];
  }
  restoreDomGlobals();
});

const ORIGINAL = ['one', 'two', 'three', 'four', 'five', 'six'].join('\n');
// Two separate changes, far enough apart that the diff keeps them as two chunks.
const NEXT = ['one', 'TWO', 'three', 'four', 'FIVE', 'six'].join('\n');

interface Mounted {
  handle: DiffViewHandle;
  positions: Array<{ index: number; count: number }>;
}

function mount(kind: 'unified' | 'split', original = ORIGINAL, next = NEXT): Mounted {
  const parent = document.createElement('div');
  host.appendChild(parent);
  const positions: Array<{ index: number; count: number }> = [];
  const options = {
    original,
    next,
    language: 'text',
    wordWrap: false,
    collapse: 'diff' as const,
    scrollTestId: 'diff-scroller',
    onScroller: () => {},
    onChunkPosition: (position: { index: number; count: number }) => positions.push(position),
  };
  const handle = kind === 'split' ? mountSplitDiff(parent, options) : mountUnifiedDiff(parent, options);
  return { handle, positions };
}

describe('chunk position', () => {
  test('a changed pair reports its chunks on mount', () => {
    for (const kind of ['unified', 'split'] as const) {
      const { handle } = mount(kind);
      const position = handle.chunkPosition();
      expect(position.count).toBe(2);
      // The selection starts at the top, which is not inside a chunk.
      expect(position.index).toBe(-1);
      handle.destroy();
    }
  });

  test('an identical pair reports no chunks', () => {
    const { handle } = mount('unified', ORIGINAL, ORIGINAL);
    expect(handle.chunkPosition()).toEqual({ index: -1, count: 0 });
    // Nothing to step to, so the toolbar must be able to tell.
    expect(handle.stepChunk(1)).toBe(false);
    handle.destroy();
  });

  test('the mount reports the seed position, so the badge is not "0 of 0"', () => {
    const { handle, positions } = mount('unified');
    expect(positions[0]).toEqual({ index: -1, count: 2 });
    handle.destroy();
  });
});

describe('stepChunk', () => {
  test('steps forward through every chunk and wraps', () => {
    const { handle } = mount('unified');
    expect(handle.stepChunk(1)).toBe(true);
    expect(handle.chunkPosition().index).toBe(0);
    expect(handle.stepChunk(1)).toBe(true);
    expect(handle.chunkPosition().index).toBe(1);
    // Past the last one is the first one again: the package's own wrap.
    expect(handle.stepChunk(1)).toBe(true);
    expect(handle.chunkPosition().index).toBe(0);
    handle.destroy();
  });

  test('steps backward and wraps the other way', () => {
    const { handle } = mount('unified');
    expect(handle.stepChunk(-1)).toBe(true);
    expect(handle.chunkPosition().index).toBe(1);
    expect(handle.stepChunk(-1)).toBe(true);
    expect(handle.chunkPosition().index).toBe(0);
    handle.destroy();
  });

  test('the split shape steps the B side, which is the working file', () => {
    const { handle } = mount('split');
    expect(handle.stepChunk(1)).toBe(true);
    expect(handle.chunkPosition().index).toBe(0);
    expect(handle.stepChunk(1)).toBe(true);
    expect(handle.chunkPosition().index).toBe(1);
    handle.destroy();
  });

  test('a single chunk is entered once and then refuses to move', () => {
    // Measured: the package only refuses when the caret is ALREADY inside the
    // one chunk. From outside it, the first step is the useful one — it puts the
    // caret on the change — and every step after that returns false rather than
    // re-selecting the same row.
    const { handle } = mount('unified', 'a\nb\nc', 'a\nB\nc');
    expect(handle.chunkPosition().count).toBe(1);
    expect(handle.stepChunk(1)).toBe(true);
    expect(handle.chunkPosition().index).toBe(0);
    expect(handle.stepChunk(1)).toBe(false);
    handle.destroy();
  });
});
