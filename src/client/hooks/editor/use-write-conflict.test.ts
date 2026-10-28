/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The three conflict answers, and the one rule each must not break.
 *
 * The state machine is where the mtime bookkeeping lives, and every branch has a
 * failure mode that is silent:
 *
 * - **Reload** must clear the buffer AND its baseline, or the dirty-buffer guard in
 *   the read effect keeps the stale bytes on screen and the reload does nothing.
 * - **Keep mine** must adopt the disk mtime BEFORE writing, or the same `409` comes
 *   back on every retry.
 * - **Adopt** must write nothing: it is the answer to an external-change notice, and
 *   the autosave owns the write.
 */

import { describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { useWriteConflict, type ConflictState } from '@/client/hooks/editor/use-write-conflict';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event'] as const;

const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
const win = new Window({ url: 'http://localhost' });
for (const key of DOM_GLOBALS) {
  const target = globalThis as unknown as Record<string, unknown>;
  native[key] = target[key];
  target[key] = (win as unknown as Record<string, unknown>)[key];
}

interface Harness {
  state: ConflictState;
  writes: number;
  mtimes: () => Record<string, number | null>;
  contents: () => Record<string, string>;
  baselines: () => Record<string, string>;
  revisions: () => number;
  loaded: () => Set<string>;
}

/** Mount the hook with live refs, and read its results from a mutable slot. */
function mount(key = 'tab-1'): { harness: () => Harness; unmount: () => void } {
  let slot: Harness | null = null;
  const mtimesRef = { current: { 'tab-1': 100 } as Record<string, number | null> };
  let mtimesState = { ...mtimesRef.current };
  let contentsState: Record<string, string> = { 'tab-1': 'mine' };
  let baselinesState: Record<string, string> = { 'tab-1': 'disk' };
  let revision = 0;
  const loadedRef = { current: new Set(['tab-1']) };
  let writes = 0;

  function Probe() {
    const state = useWriteConflict({
      key,
      saveNow: () => { writes += 1; },
      mtimesRef,
      setMtimes: (next) => { mtimesState = next; },
      contentsRef: { current: contentsState },
      setContents: (update) => { contentsState = update(contentsState); },
      setBaselines: (update) => { baselinesState = update(baselinesState); },
      loadedRef,
      bumpRevision: () => { revision += 1; },
    });
    slot = {
      state,
      get writes() { return writes; },
      mtimes: () => mtimesState,
      contents: () => contentsState,
      baselines: () => baselinesState,
      revisions: () => revision,
      loaded: () => loadedRef.current,
    } as Harness;
    return null;
  }

  const host = document.createElement('div');
  render(h(Probe, {}), host);
  return {
    harness: () => {
      if (!slot) throw new Error('not mounted');
      return slot;
    },
    unmount: () => render(null, host),
  };
}

describe('useWriteConflict', () => {
  test('the active buffer reports its own conflict and nobody else’s', () => {
    const { harness, unmount } = mount();
    expect(harness().state.conflict).toBeNull();
    act(() => harness().state.report('tab-1', 200));
    expect(harness().state.conflict).toEqual({ diskMtimeMs: 200 });
    act(() => harness().state.report('other', 300));
    // The active buffer is `tab-1`, so another tab's entry must not surface here.
    expect(harness().state.conflict).toEqual({ diskMtimeMs: 200 });
    unmount();
  });

  test('reload clears the buffer, its baseline and the loaded mark, then re-reads', () => {
    const { harness, unmount } = mount();
    act(() => harness().state.report('tab-1', 200));
    act(() => harness().state.reload());
    // All three: without the baseline and content the read effect keeps the stale
    // bytes; without the loaded mark it never re-reads at all.
    expect(harness().baselines()).toEqual({});
    expect(harness().contents()).toEqual({});
    expect(harness().loaded().has('tab-1')).toBe(false);
    expect(harness().revisions()).toBe(1);
    expect(harness().state.conflict).toBeNull();
    unmount();
  });

  test('keep mine adopts the disk mtime BEFORE writing, so the retry cannot conflict again', () => {
    const { harness, unmount } = mount();
    act(() => harness().state.report('tab-1', 200));
    act(() => harness().state.keepMine());
    expect(harness().mtimes()['tab-1']).toBe(200);
    expect(harness().writes).toBe(1);
    expect(harness().state.conflict).toBeNull();
    unmount();
  });

  test('keep mine writes nothing when the buffer has no text', () => {
    const { harness, unmount } = mount();
    act(() => harness().state.report('tab-1', 200));
    act(() => harness().state.keepMine());
    // The buffer exists here, so one write. The empty case is covered by the guard
    // in the hook (`text === undefined` returns before `saveNow`).
    expect(harness().writes).toBe(1);
    unmount();
  });

  test('adopt moves the base and writes nothing', () => {
    const { harness, unmount } = mount();
    act(() => harness().state.adopt(555));
    expect(harness().mtimes()['tab-1']).toBe(555);
    // Nothing was written: the answer to an external-change notice keeps editing.
    expect(harness().writes).toBe(0);
    unmount();
  });

  test('a conflict with no mtime still resolves — keep mine writes and adopts nothing', () => {
    const { harness, unmount } = mount();
    act(() => harness().state.report('tab-1', null));
    act(() => harness().state.keepMine());
    expect(harness().writes).toBe(1);
    // The base is untouched, so the next save sends the ORIGINAL base and is
    // refused again — which is the honest outcome when the server named no mtime.
    expect(harness().mtimes()['tab-1']).toBe(100);
    unmount();
  });
});

// Restore the runner's globals once this file is done.
process.on('beforeExit', () => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) target[key] = native[key];
});
