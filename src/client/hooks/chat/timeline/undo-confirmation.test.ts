/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The undo confirmation gate, on its own.
 *
 * Split out of `composer-local-actions.test.ts` because that file reached the
 * repo's 350-line ceiling and held three unrelated subjects; `undo-confirmation`
 * is its own module, so its cases are its own file.
 *
 * A REFUSAL is a result, not a slow request: the endpoint answers 400 with a
 * reason, and the old contract turned that into a modal that never closed. A
 * second confirm while one is in flight must be ignored, or a double click
 * rewinds twice.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useUndoConfirmation } from '@/client/hooks/chat/timeline/undo-confirmation';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent'] as const;
/** The runner's own globals, restored on teardown so later files still have them. */
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

/** The undo gate's surface. `undo-confirmation.ts` exports only the hook, so
 *  the shape a caller sees is restated here rather than read off the function. */
interface UndoGate {
  pendingUndo: { id: string; content: string } | null;
  undoing: boolean;
  error: string | null;
  requestUndo: (id: string, content?: string) => void;
  closeUndoConfirm: () => void;
  confirmUndo: () => Promise<void>;
}

let container: HTMLElement | undefined;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
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

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  container = undefined;
});

describe('useUndoConfirmation', () => {
  let undo: UndoGate | undefined;

  function UndoProbe({ onUndo }: { onUndo: (id: string, content: string) => Promise<boolean> }) {
    undo = useUndoConfirmation(onUndo);
    return null;
  }

  async function open(onUndo: (id: string, content: string) => Promise<boolean>): Promise<void> {
    container ??= document.body.appendChild(document.createElement('div'));
    await act(async () => { render(h(UndoProbe, { onUndo }), container as HTMLElement); });
  }

  test('a request opens the gate with the row it was given', async () => {
    await open(async () => true);
    await act(async () => { undo?.requestUndo('m1', 'the prompt'); });
    expect(undo?.pendingUndo).toEqual({ id: 'm1', content: 'the prompt' });
  });

  test('a request without content opens with an empty one', async () => {
    await open(async () => true);
    await act(async () => { undo?.requestUndo('m1'); });
    expect(undo?.pendingUndo).toEqual({ id: 'm1', content: '' });
  });

  test('a successful undo closes the gate', async () => {
    const calls: string[] = [];
    await open(async (id, content) => { calls.push(`${id}|${content}`); return true; });
    await act(async () => { undo?.requestUndo('m1', 'p'); });
    await act(async () => { await undo?.confirmUndo(); });
    expect(calls).toEqual(['m1|p']);
    expect(undo?.pendingUndo).toBeNull();
    expect(undo?.error).toBeNull();
  });

  test('a refused undo keeps the gate open WITH the reason', async () => {
    await open(async () => false);
    await act(async () => { undo?.requestUndo('m1'); });
    await act(async () => { await undo?.confirmUndo(); });
    expect(undo?.pendingUndo).toEqual({ id: 'm1', content: '' });
    expect(undo?.undoing).toBe(false);
    expect(undo?.error).toContain('Undo failed');
  });

  test('a second confirm while one is in flight is ignored', async () => {
    const pending = Promise.withResolvers<boolean>();
    const calls: string[] = [];
    await open((id) => { calls.push(id); return pending.promise; });
    await act(async () => { undo?.requestUndo('m1'); });
    await act(async () => { void undo?.confirmUndo(); });
    expect(undo?.undoing).toBe(true);
    await act(async () => { void undo?.confirmUndo(); });
    expect(calls).toEqual(['m1']);
    pending.resolve(true);
    await act(async () => {});
    expect(undo?.pendingUndo).toBeNull();
  });

  test('cancelling clears the gate and its reason', async () => {
    await open(async () => false);
    await act(async () => { undo?.requestUndo('m1'); });
    await act(async () => { await undo?.confirmUndo(); });
    await act(async () => { undo?.closeUndoConfirm(); });
    expect(undo?.pendingUndo).toBeNull();
    expect(undo?.error).toBeNull();
  });
});
