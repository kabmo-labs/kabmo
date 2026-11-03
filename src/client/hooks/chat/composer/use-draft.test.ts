/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The composer draft's SCOPE: a chat named in the URL, or the landing.
 *
 * The reported bug this pins: text appended while no session was open (an
 * annotation sent from the browser panel) was stored on the provider's fallback
 * id — the landing's own bucket — which is not a chat and never gets cleared,
 * because the landing composer is disabled and nothing can send or clear it.
 * Every later launch then opened with that text already in the box, reading as
 * something the new chat had inherited.
 *
 * A landing draft is therefore memory-only. The cases below mount the real
 * provider id the way `App` derives it (`?sessionId=` else `'1'`), so the
 * fallback bucket is still the landing's store — it is just not WRITTEN.
 *
 * The hook is imported DYNAMICALLY, after the DOM exists: `useSearchParams`
 * caches the search string and subscribes to `popstate` when its module loads,
 * so a static import (evaluated before any `beforeAll` runs) would leave the
 * router unable to see the URL these cases set. The module-load boundary is the
 * subject here, which is the documented exception to static imports.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { forgetSession, getSessionValue, setSessionKey } from '@/shared/lib/workspace/session-state/store';
import { emitBrowserPageContext } from '@/shared/lib/browser/page-context';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { CHAT_DRAFT_KEY } from '@/shared/lib/chat/composer/draft';
import type { Context } from 'preact';
import type { ComposerDraftState } from '@/client/hooks/chat/composer/use-draft';
import type { SessionStateContextValue } from '@/client/hooks/workspace/session-state/context';

const LANDING_ID = '1';
const SEEDED = '[Konteks halaman browser]\nURL: http://localhost:7801/\n(Lanjutkan dari halaman ini.)';

let container: HTMLElement | undefined;
let holder: { api: ComposerDraftState | null };
let useComposerDraft: () => ComposerDraftState;
let SessionStateContext: Context<SessionStateContextValue | null>;
const nativeFetch = globalThis.fetch;

beforeAll(async () => {
  installDomGlobals(new Window({ url: 'http://127.0.0.1/' }));
  ({ useComposerDraft } = await import('@/client/hooks/chat/composer/use-draft'));
  ({ SessionStateContext } = await import('@/client/hooks/workspace/session-state/context'));
});

beforeEach(() => {
  // Writes are debounced-persisted; a stray POST is not what these cases read.
  globalThis.fetch = (async () => new Response('{"state":{}}')) as unknown as typeof fetch;
  forgetSession(LANDING_ID);
  holder = { api: null };
  pointAt('');
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  container = undefined;
  forgetSession(LANDING_ID);
});

afterAll(() => {
  // The router caches `location.search` in a module and subscribes to
  // `popstate` on the window that existed when IT loaded — this suite's. Put
  // that cache back to the bare path before the window goes away, or every
  // later suite in the same `bun test` process reads `?sessionId=1` off a
  // window nobody can reach any more (measured: the sidebar controller drew a
  // stray `1` row).
  pointAt('');
  globalThis.fetch = nativeFetch;
  restoreDomGlobals();
});

function pointAt(search: string): void {
  window.history.replaceState(null, '', `/${search}`);
  window.dispatchEvent(new Event('popstate'));
}

/** Mount the draft hook for one URL, with the provider id `App` derives. */
function mount(search: string): void {
  pointAt(search);
  const sessionId = new URLSearchParams(search).get('sessionId') || LANDING_ID;
  function Probe() {
    holder.api = useComposerDraft();
    return null;
  }
  container = document.body.appendChild(document.createElement('div'));
  act(() => {
    render(
      h(SessionStateContext.Provider, { value: { sessionId, ready: true }, children: h(Probe, null) }),
      container!,
    );
  });
}

describe('useComposerDraft', () => {
  test('the landing does not restore the fallback bucket\'s draft', () => {
    setSessionKey(LANDING_ID, CHAT_DRAFT_KEY, SEEDED);
    mount('');
    expect(holder.api!.inputValue).toBe('');
  });

  test('a landing draft is kept in memory and never written to a session slot', () => {
    mount('');
    act(() => holder.api!.setInputValue('typed at the landing'));
    expect(holder.api!.inputValue).toBe('typed at the landing');
    expect(getSessionValue(LANDING_ID, CHAT_DRAFT_KEY)).toBeUndefined();
  });

  test('an annotation sent at the landing stays out of the persisted draft', () => {
    mount('');
    act(() => emitBrowserPageContext({ url: 'https://a.test/x' }));
    expect(holder.api!.inputValue).toContain('[Konteks halaman browser]');
    expect(getSessionValue(LANDING_ID, CHAT_DRAFT_KEY)).toBeUndefined();
  });

  test('a session named in the URL still restores and persists its own draft', () => {
    setSessionKey(LANDING_ID, CHAT_DRAFT_KEY, SEEDED);
    mount(`?sessionId=${LANDING_ID}`);
    expect(holder.api!.inputValue).toBe(SEEDED);
    act(() => holder.api!.setInputValue('follow-up'));
    expect(getSessionValue(LANDING_ID, CHAT_DRAFT_KEY)).toBe('follow-up');
  });
});
