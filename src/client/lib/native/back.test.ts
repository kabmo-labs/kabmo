/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import {
  BACK_PROPERTY,
  dispatchBack,
  installBackDispatcher,
  registerBackHandler,
} from '@/client/lib/native/back';

/**
 * The stack is module state, so every case unregisters what it added. The
 * shell's contract is exactly two facts: last-registered wins, and the first
 * handler that answers `true` stops the walk.
 */
const cleanups: Array<() => void> = [];

function onBack(handler: () => boolean): () => boolean {
  const remove = registerBackHandler(handler);
  cleanups.push(remove);
  return handler;
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

describe('dispatchBack', () => {
  test('reports false when nothing is registered', () => {
    expect(dispatchBack()).toBe(false);
  });

  test('the last registered handler runs first', () => {
    const order: string[] = [];
    onBack(() => {
      order.push('first');
      return false;
    });
    onBack(() => {
      order.push('second');
      return true;
    });

    expect(dispatchBack()).toBe(true);
    expect(order).toEqual(['second']);
  });

  test('the first true stops the walk', () => {
    const order: string[] = [];
    onBack(() => {
      order.push('inner');
      return true;
    });
    onBack(() => {
      order.push('outer');
      return false;
    });

    expect(dispatchBack()).toBe(true);
    expect(order).toEqual(['outer', 'inner']);
  });

  test('a throwing handler is skipped, and the next one still gets the press', () => {
    onBack(() => {
      throw new Error('broken handler');
    });
    onBack(() => true);

    expect(dispatchBack()).toBe(true);
  });

  test('unregistering removes the handler', () => {
    let calls = 0;
    const remove = registerBackHandler(() => {
      calls += 1;
      return false;
    });
    remove();

    expect(dispatchBack()).toBe(false);
    expect(calls).toBe(0);
  });
});

describe('installBackDispatcher', () => {
  test('exposes window.__kabmoBack and is idempotent', () => {
    const win = new Window({ url: 'http://localhost/' });
    const target = globalThis as unknown as Record<string, unknown>;
    const previous = target.window;
    target.window = win;
    try {
      installBackDispatcher();
      installBackDispatcher();

      const installed = (win as unknown as Record<string, unknown>)[BACK_PROPERTY];
      expect(typeof installed).toBe('function');
      expect((installed as () => boolean)()).toBe(false);
    } finally {
      target.window = previous;
      win.close();
    }
  });
});
