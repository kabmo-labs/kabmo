/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The change list's read timing.
 *
 * A reader who opens a LIVE session must still see the settled runs' file
 * lists. The hook used to skip the read while `isGenerating`, so a session
 * opened mid-run showed no changes section at all — even though the journal
 * already held every earlier run. The mid-run read is safe: the current run's
 * partial records are bucketed into a run whose footer is not rendered yet.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useSessionChanges } from '@/client/hooks/chat/timeline/session-changes';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;
const mounted: HTMLElement[] = [];
let originalFetch: typeof fetch;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  for (const node of mounted.splice(0)) render(null, node);
  globalThis.fetch = originalFetch;
});

afterAll(() => {
  restoreDomGlobals();
});

function Probe({ sessionId, isGenerating }: { sessionId: string; isGenerating: boolean }) {
  const records = useSessionChanges(sessionId, isGenerating);
  return h('div', { 'data-count': String(records.length) });
}

describe('useSessionChanges', () => {
  test('reads on mount even while generating, so settled runs show', async () => {
    let calls = 0;
    let release: (response: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    globalThis.fetch = (() => {
      calls += 1;
      return pending;
    }) as unknown as typeof fetch;

    container = document.createElement('div');
    document.body.appendChild(container);
    mounted.push(container);

    await act(async () => {
      render(h(Probe, { sessionId: 's1', isGenerating: true }), container);
    });
    expect(calls).toBe(1);

    await act(async () => {
      release(
        new Response(
          JSON.stringify({
            records: [
              { at: 1, agent: 'Main', tool: 'edit', path: '/repo/a.ts', displayPath: 'a.ts', before: 'a', after: 'b' },
            ],
          }),
          { status: 200 },
        ),
      );
      await pending;
      // Let the hook's `res.json()` and `setRecords` run before the act flushes.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('div')?.getAttribute('data-count')).toBe('1');
  });
});
