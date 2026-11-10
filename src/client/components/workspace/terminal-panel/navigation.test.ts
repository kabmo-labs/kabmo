/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import type { Terminal } from 'ghostty-web';
import { handleKeyNavigation } from '@/client/components/workspace/terminal-panel/navigation';

function fakeTerminal() {
  const calls: string[] = [];
  const term = {
    scrollPages: (amount: number) => calls.push(`pages:${amount}`),
    scrollLines: (amount: number) => calls.push(`lines:${amount}`),
    scrollToTop: () => calls.push('top'),
    scrollToBottom: () => calls.push('bottom'),
  } as unknown as Terminal;
  return { term, calls };
}

interface KeyInit extends KeyboardEventInit {
  type: string;
  key: string;
}

function key(init: KeyInit): globalThis.KeyboardEvent {
  // The helpers read only `type`, `key` and `shiftKey`; a full DOM event is
  // unavailable under Bun.
  return init as unknown as globalThis.KeyboardEvent;
}

describe('handleKeyNavigation', () => {
  test('consumes Shift+PageUp and scrolls the viewport', () => {
    const { term, calls } = fakeTerminal();
    expect(handleKeyNavigation(term, key({ type: 'keydown', key: 'PageUp', shiftKey: true }))).toBe(true);
    expect(calls).toEqual(['pages:-1']);
  });

  test('lets an unmodified key reach the terminal encoder', () => {
    const { term, calls } = fakeTerminal();
    expect(handleKeyNavigation(term, key({ type: 'keydown', key: 'PageUp' }))).toBe(false);
    expect(handleKeyNavigation(term, key({ type: 'keydown', key: 'a', shiftKey: true }))).toBe(false);
    expect(calls).toEqual([]);
  });

  test('Shift+Home/End/Arrows are viewport gestures, not shell input', () => {
    const { term, calls } = fakeTerminal();
    handleKeyNavigation(term, key({ type: 'keydown', key: 'Home', shiftKey: true }));
    handleKeyNavigation(term, key({ type: 'keydown', key: 'End', shiftKey: true }));
    handleKeyNavigation(term, key({ type: 'keydown', key: 'ArrowUp', shiftKey: true }));
    handleKeyNavigation(term, key({ type: 'keydown', key: 'ArrowDown', shiftKey: true }));
    expect(calls).toEqual(['top', 'bottom', 'lines:-1', 'lines:1']);
  });
});
