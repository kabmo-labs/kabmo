/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `bash` card for a result omp's shell minimizer rewrote (18.16.0).
 *
 * The panel used to draw the compressed body with nothing saying so: a
 * `git --no-pager log` that lost 7 KB of commits looked like the command's own
 * output. The record omp sends is
 *
 *   details.meta.minimized = { filter: 'git', inputBytes: 10970,
 *                              outputBytes: 3905, artifactId: '0' }
 *
 * and this pins that the card states it, and that a result the minimizer left
 * alone says nothing rather than drawing an empty strip.
 *
 * Rendered with `h()` against happy-dom, following `panels/Edit.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { Bash } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/Bash';
import type { ToolCallData } from '@/shared/types';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let container: HTMLElement;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});

async function mount(details: Record<string, unknown>): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  const tool = {
    id: 'c1',
    type: 'bash',
    name: 'bash',
    title: 'bash',
    command: 'git --no-pager log',
    output: 'b7b0b41 commit number 60\n6c1bd61 commit number 59',
    status: 'success',
    details,
  } as ToolCallData;
  await act(async () => {
    render(h(Bash, { tool }), container);
  });
  return container;
}

describe('bash panel — minimized output', () => {
  test('states the filter that ran and both byte sizes', async () => {
    const el = await mount({
      wallTimeMs: 412,
      meta: { minimized: { filter: 'git', inputBytes: 10970, outputBytes: 3905, artifactId: '0' } },
    });
    const text = el.textContent ?? '';
    expect(text).toContain('Minimized');
    expect(text).toContain('git');
    expect(text).toContain('10.7 KB');
    expect(text).toContain('3.8 KB');
    expect(text).toContain('the output below is the filtered rewrite');
  });

  test('says nothing when the minimizer left the output alone', async () => {
    const el = await mount({ wallTimeMs: 12, meta: { limits: {} } });
    expect(el.textContent ?? '').not.toContain('Minimized');
  });
});
