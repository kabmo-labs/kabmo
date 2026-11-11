/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A focus request that lands before the terminal exists.
 *
 * The panel opens its shell with `term.focus()` at the moment it becomes
 * visible, while ghostty-web is still being imported; without the latch that
 * request was a no-op and the first command of a freshly opened panel went
 * nowhere. Measured on the assembled product: the panel was open, the grid was
 * live, and typing produced no frames until the canvas was clicked.
 */

import { describe, expect, test } from 'bun:test';
import { createFocusLatch } from '@/client/components/workspace/terminal-panel/focus';

describe('createFocusLatch', () => {
  test('serves a request made before the terminal mounted', () => {
    const latch = createFocusLatch();
    let focused = 0;

    latch.request();
    expect(focused).toBe(0);

    latch.attach(() => {
      focused += 1;
    });
    expect(focused).toBe(1);
  });

  test('serves a pending request only once', () => {
    const latch = createFocusLatch();
    let focused = 0;
    const focus = () => {
      focused += 1;
    };

    latch.request();
    latch.attach(focus);
    latch.attach(focus);
    expect(focused).toBe(1);
  });

  test('focuses immediately once a terminal is attached', () => {
    const latch = createFocusLatch();
    let focused = 0;
    latch.attach(() => {
      focused += 1;
    });

    latch.request();
    latch.request();
    expect(focused).toBe(2);
  });

  test('drops the target and the pending request on detach', () => {
    const latch = createFocusLatch();
    let focused = 0;
    const focus = () => {
      focused += 1;
    };

    latch.attach(focus);
    latch.detach();
    latch.request();
    expect(focused).toBe(0);
  });
});
