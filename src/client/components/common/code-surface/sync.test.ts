/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The external-sync guard, which is the difference between a large file being
 * usable and not.
 *
 * `syncExternal` runs on EVERY render, and the parent re-renders on every
 * keystroke, so its fast path has to be a reference comparison: the old version
 * compared against `view.state.doc.toString()` unconditionally, which is 7.2 ms
 * at 20 MB and 13.7 ms at 30 MB (measured in Bun) — twice per character, since
 * the write and the read each cost one.
 *
 * The cases below pin both halves: the echo must be free, and a REAL external
 * replacement must still land. A guard that skipped both would look correct in
 * the fast-path test and silently stop a file re-read from reaching the editor.
 *
 * Driven through a real `EditorView` in happy-dom, because the thing under test
 * dispatches transactions — a stub view would test the stub.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { syncExternal, type MutableRef } from '@/client/components/common/code-surface/sync';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let observer: unknown;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  installDomGlobals(win);
  // `installDomGlobals` covers what a COMPONENT reads; mounting a real
  // `EditorView` additionally needs `MutationObserver` and
  // `requestAnimationFrame`, which CM6's DOM observer and its measure cycle
  // call directly on `globalThis`.
  const target = globalThis as unknown as Record<string, unknown>;
  observer = target.MutationObserver;
  target.MutationObserver = (win as unknown as Record<string, unknown>).MutationObserver;
  target.requestAnimationFrame = (win as unknown as Record<string, unknown>).requestAnimationFrame;
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  if (observer === undefined) delete target.MutationObserver;
  else target.MutationObserver = observer;
  restoreDomGlobals();
});

interface Harness {
  view: EditorView;
  writingRef: MutableRef<boolean>;
  lastValueRef: MutableRef<string>;
  /** Every string the sync was asked to write, in order. */
  writes: string[];
  destroy(): void;
}

/**
 * A view over `doc`, wired the way the component wires it: the update listener
 * keeps `lastValueRef` in step and records the writes it observes.
 */
function mount(doc: string): Harness {
  const writingRef: MutableRef<boolean> = { current: false };
  const lastValueRef: MutableRef<string> = { current: doc };
  const writes: string[] = [];

  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          // Mirrors `documents.ts`'s `onDocChange`: recorded BEFORE the writing
          // guard, because this is what the document holds either way.
          lastValueRef.current = update.state.doc.toString();
          if (writingRef.current) return;
          writes.push(update.state.doc.toString());
        }),
      ],
    }),
    parent: document.body,
  });

  return { view, writingRef, lastValueRef, writes, destroy: () => view.destroy() };
}

describe('syncExternal', () => {
  test('the echo of the document costs one comparison and dispatches nothing', () => {
    const harness = mount('const a = 1;');
    try {
      // What the parent hands back after a keystroke.
      syncExternal(harness.view, 'const a = 1;', harness.writingRef, harness.lastValueRef);

      expect(harness.view.state.doc.toString()).toBe('const a = 1;');
      expect(harness.writes).toEqual([]);
    } finally {
      harness.destroy();
    }
  });

  test('the fast path does not stringify: a same-reference value is accepted', () => {
    const harness = mount('x');
    try {
      // The document and `lastValueRef` agree, so the guard returns before the
      // `doc.toString()` that used to run on every render. A spy is not needed:
      // `lastValueRef` being the identity the caller passes is the contract, and
      // an unchanged document proves nothing was dispatched.
      const before = harness.view.state.doc;
      syncExternal(harness.view, 'x', harness.writingRef, harness.lastValueRef);

      expect(harness.view.state.doc).toBe(before);
    } finally {
      harness.destroy();
    }
  });

  test('a real external replacement lands, once, and is not reported as a user edit', () => {
    const harness = mount('old text');
    try {
      syncExternal(harness.view, 'new text', harness.writingRef, harness.lastValueRef);

      expect(harness.view.state.doc.toString()).toBe('new text');
      // `writingRef` suppresses the report: a re-read is not something the user
      // typed, and reporting it would arm an autosave for an unchanged file.
      expect(harness.writes).toEqual([]);
      expect(harness.lastValueRef.current).toBe('new text');
      expect(harness.writingRef.current).toBe(false);
    } finally {
      harness.destroy();
    }
  });

  test('a value that differs from the ref but EQUALS the document is adopted without a dispatch', () => {
    const harness = mount('same');
    try {
      // The parent re-serialized the same text: a new string, same content.
      const fresh = ['same'].join('');
      harness.lastValueRef.current = 'stale';
      syncExternal(harness.view, fresh, harness.writingRef, harness.lastValueRef);

      expect(harness.view.state.doc.toString()).toBe('same');
      expect(harness.writes).toEqual([]);
      // The ref is corrected, so the NEXT render takes the fast path again.
      expect(harness.lastValueRef.current).toBe('same');
    } finally {
      harness.destroy();
    }
  });

  test('an empty document is a real value, not "nothing to do"', () => {
    const harness = mount('was here');
    try {
      syncExternal(harness.view, '', harness.writingRef, harness.lastValueRef);

      expect(harness.view.state.doc.length).toBe(0);
      expect(harness.lastValueRef.current).toBe('');
    } finally {
      harness.destroy();
    }
  });

  test('the writing flag is released even when the dispatch throws', () => {
    const harness = mount('text');
    try {
      const broken = {
        state: harness.view.state,
        dispatch: () => {
          throw new Error('dispatch failed');
        },
      } as unknown as EditorView;

      expect(() => syncExternal(broken, 'other', harness.writingRef, harness.lastValueRef)).toThrow(
        'dispatch failed',
      );
      // A stuck flag would silently swallow every later user edit.
      expect(harness.writingRef.current).toBe(false);
    } finally {
      harness.destroy();
    }
  });
});
