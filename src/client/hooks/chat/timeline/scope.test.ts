/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The chat's folder scope IS the URL's `folderId` — read, never mirrored.
 *
 * The New Chat dialog's first send is dispatched in the SAME commit that writes
 * `?folderId=` for the pending chat (`useNewChatSubmit` → the parked send). A
 * copy kept in `useState` and synced by an effect is one render behind there,
 * so the spawn read the PREVIOUS folder and the prompt landed in another
 * workspace than the prewarmed one. These cases pin the value's freshness, not
 * the mirror's mechanism.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { useTimelineScope, type TimelineScope } from '@/client/hooks/chat/timeline/scope';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const BASE = 'http://localhost/?sessionId=omp-a&folderId=9';

let container: HTMLElement | undefined;
let scope: TimelineScope | null = null;
/** `selectedFolderId` of every render, in order. */
const renders: Array<number | null> = [];

function Probe() {
  const current = useTimelineScope();
  scope = current;
  renders.push(current.selectedFolderId);
  return null;
}

async function mount() {
  container = document.body.appendChild(document.createElement('div'));
  await act(async () => { render(h(Probe, {}), container as HTMLElement); });
  await act(async () => {});
}

beforeAll(() => {
  installDomGlobals(new Window({ url: BASE }));
});

afterAll(() => {
  restoreDomGlobals();
});

beforeEach(() => {
  window.history.replaceState(null, '', BASE);
  renders.length = 0;
  scope = null;
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  container = undefined;
});

describe('useTimelineScope', () => {
  test('the URL folder is on the FIRST render a URL write produces', async () => {
    await mount();
    expect(renders).toEqual([9]);

    const before = renders.length;
    await act(async () => {
      // Exactly what the New Chat dialog does: the pending chat's id and the
      // workspace it was started from, in one write.
      scope?.setSearchParams((prev) => {
        prev.set('sessionId', 'new-1');
        prev.set('folderId', '7');
        return prev;
      }, { replace: true });
    });

    // A mirrored copy answered `9` here and only caught up on the next render —
    // which is the commit the parked send already used.
    expect(renders[before]).toBe(7);
    expect(scope?.sessionId).toBe('new-1');
  });

  test('the picker writes the param and reads back the number', async () => {
    await mount();

    await act(async () => { scope?.selectContextFolder(11); });

    expect(window.location.search).toContain('folderId=11');
    expect(scope?.selectedFolderId).toBe(11);

    await act(async () => { scope?.selectContextFolder(null); });

    expect(window.location.search).not.toContain('folderId');
    expect(scope?.selectedFolderId).toBeNull();
  });
});
