/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The DOM harness both `read` panel suites mount through.
 *
 * Two files share it because the panel answers two different questions — what
 * it does with a result that carries no text (the lazy `/api/fs/read` fallback,
 * the markdown branch) and what it paints when the result is a picture — and
 * each suite is at the repo's per-file ceiling on its own.
 *
 * `happy-dom` is installed as globals here rather than in the suites so the two
 * cannot drift on which globals a mounted panel needs. `fetch` is stubbed
 * because the panel reads the status AND the body: a refused read is
 * `ok: false` with an `error`, and the assertions are about which sentence the
 * panel printed.
 */

import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { Read } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/Read';
import type { ToolCallData } from '@/shared/types';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'fetch'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

/** Every URL the panel asked `/api/fs/read` for, in order. */
export const fetchCalls: string[] = [];

/** The next response the stub hands back. Defaults to a 200 carrying `hello`. */
export let nextResponse: { ok: boolean; status: number; body: unknown } = {
  ok: true,
  status: 200,
  body: { content: 'hello' },
};

/** Replace the stub's answer; call from `beforeEach` or inside a test. */
export function setNextResponse(response: { ok: boolean; status: number; body: unknown }): void {
  nextResponse = response;
}

/** Install the browser globals and the fetch stub; call from `beforeAll`. */
export function installReadDom(): void {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  const stub = (async (url: string) => {
    fetchCalls.push(String(url));
    const { ok, status, body } = nextResponse;
    return { ok, status, json: async () => body };
  }) as unknown as typeof globalThis.fetch;
  globalThis.fetch = stub;
}

/** Put the previous globals back; call from `afterAll`. */
export function restoreReadDom(): void {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
}

/** Mount the panel for one call and flush the effect + its fetch microtask chain. */
export async function mountRead(tool: ToolCallData): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(Read, { tool, output: tool.output ?? '' }), container);
  });
  // The reader awaits `fetch` and then `res.json()`, and each state write lands
  // a turn later; a few separate `act` passes drain that chain without binding
  // the test to the clock.
  for (let pass = 0; pass < 4; pass += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  return container;
}

/** A `read` call with the fields every case shares. */
export function readTool(partial: Partial<ToolCallData>): ToolCallData {
  return { id: 'r1', type: 'read', name: 'read', title: 'read', output: '', status: 'success', details: {}, ...partial } as ToolCallData;
}
