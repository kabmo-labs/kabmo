/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The DOM harness both `wait` panel suites mount through.
 *
 * Two files share it because the panel's two halves are different questions —
 * a live/settled call (clock, bar, jobs) and a call with NO result (the reload
 * shape) — and each suite is at the repo's per-file ceiling on its own.
 *
 * `happy-dom` is installed as globals here rather than in the suites so the two
 * cannot drift on which globals a mounted panel needs; `render` runs inside
 * `act` because the stopwatch schedules a `setInterval` on mount.
 */

import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { Wait } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/Wait';
import type { ToolCallData } from '@/shared/types';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

/** Install the browser globals; call from `beforeAll`. */
export function installWaitDom(): void {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
}

/** Put the previous globals back; call from `afterAll`. */
export function restoreWaitDom(): void {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
}

/** Mount the panel for one call and return its container. */
export async function mountWait(
  partial: Partial<ToolCallData> & Pick<ToolCallData, 'type'>,
): Promise<HTMLElement> {
  const tool = { id: 'c1', name: partial.type, title: partial.type, ...partial } as ToolCallData;
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(Wait, { tool }), container);
  });
  return container;
}

/** The panel's progress track, if it drew one. */
export function waitBar(el: HTMLElement): HTMLElement | null {
  return el.querySelector('[role="progressbar"]');
}
