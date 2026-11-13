/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The session menu's "Fork chat" action: the whole-chat fork entry point for a
 * harness whose agent takes no fork point. It must appear only where the agent
 * can fork at all, and it must open the same pending composer the per-message
 * Fork uses — with no anchor.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { SessionActionsMenu } from '@/client/components/common/session-actions-menu';
import { resetHarnessesStore } from '@/client/hooks/models/harness-catalog';
import { pendingEntryFor } from '@/client/hooks/chat/omp/pending-sessions';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const anchor = { top: 0, right: 0, bottom: 0, left: 0, align: 'end' as const };
let container: HTMLElement;
let nativeFetch: typeof fetch;

beforeEach(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  resetHarnessesStore();
  nativeFetch = globalThis.fetch;
  container = document.body.appendChild(document.createElement('div'));
});

afterEach(() => {
  render(null, container);
  container.remove();
  globalThis.fetch = nativeFetch;
});

afterAll(() => restoreDomGlobals());

function stubHarnesses(harnesses: unknown[]): void {
  // A test double for the catalog read; `fetch` carries statics the stub does
  // not need, so the cast goes through `unknown`.
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ harnesses }), { status: 200 })) as unknown as typeof fetch;
}

async function mount(harness: string): Promise<HTMLElement> {
  // A previous mount's portal lives on `body`; unmount it before the next one.
  render(null, container);
  await act(async () => {
    render(
      h(SessionActionsMenu, {
        anchor,
        sessionId: 's1',
        harness,
        folderId: 1,
        onClose: () => {},
      }),
      container,
    );
  });
  return document.body;
}

function forkItem(el: HTMLElement): HTMLElement | null {
  return ([...el.querySelectorAll('[role="menuitem"]')]
    .find((item) => item.textContent?.trim() === 'Fork chat') as HTMLElement | undefined) ?? null;
}

describe('session menu fork chat', () => {
  test('a tip harness offers Fork chat', async () => {
    stubHarnesses([{ id: 'zcode', probe: { capabilities: { forkSession: true } } }]);
    expect(forkItem(await mount('zcode'))).not.toBeNull();
  });

  test('a harness whose probe says no fork gets no item', async () => {
    stubHarnesses([{ id: 'qwen', probe: { capabilities: { forkSession: false } } }]);
    expect(forkItem(await mount('qwen'))).toBeNull();
  });

  test('without a probe the expected capability decides', async () => {
    stubHarnesses([]);
    expect(forkItem(await mount('claude'))).not.toBeNull();
    expect(forkItem(await mount('dsh'))).toBeNull();
  });

  test('the action opens a whole-chat fork with no anchor', async () => {
    stubHarnesses([{ id: 'zcode', probe: { capabilities: { forkSession: true } } }]);
    const el = await mount('zcode');
    const item = forkItem(el);
    expect(item).not.toBeNull();
    act(() => item!.click());

    const params = new URLSearchParams(window.location.search);
    expect(params.get('forkFrom')).toBe('s1');
    expect(params.get('forkAt')).toBeNull();
    const pendingId = params.get('sessionId');
    expect(pendingId).not.toBeNull();
    expect(pendingEntryFor(pendingId)).toMatchObject({
      forkSourceSessionId: 's1',
      harness: 'zcode',
    });
    expect(pendingEntryFor(pendingId)?.forkAnchorEntryId).toBeUndefined();
  });
});

describe('session menu placement', () => {
  test('the panel hangs below the trigger it was opened from', async () => {
    // A trailing `⋯` in the middle of a phone drawer: below it is where the
    // menu belongs, and the menu's own arithmetic used to flip it above when
    // its natural height exceeded the space under the row.
    stubHarnesses([]);
    render(null, container);
    await act(async () => {
      render(
        h(SessionActionsMenu, {
          anchor: { top: 300, right: 380, bottom: 322, left: 356, align: 'end' as const },
          sessionId: 's1',
          harness: 'claude',
          folderId: 1,
          onClose: () => {},
        }),
        container,
      );
    });
    const menu = document.body.querySelector('[role="menu"][aria-label="Session actions"]') as HTMLElement;
    expect(menu.style.visibility).toBe('visible');
    expect(menu.style.top).toBe('326px');
    expect(Number.parseFloat(menu.style.maxHeight)).toBeGreaterThan(0);
  });
});
