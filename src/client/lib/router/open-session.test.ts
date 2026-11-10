/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The one navigation a notification click performs.
 *
 * The app's routing state is the URL, so the cases here are the ways a click
 * could land somewhere wrong: it must replace `sessionId`, keep the folder the
 * user was in, drop a subagent view, and tell the search-param store — a
 * `pushState` alone re-renders nothing.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import { openSessionInUrl } from '@/client/lib/router/open-session';
import { installOpenSessionDispatcher } from '@/client/lib/native/open-session';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let win: Window;

beforeAll(() => {
  win = new Window({ url: 'http://localhost/' });
  installDomGlobals(win);
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

afterAll(() => {
  restoreDomGlobals();
});

function go(search: string): void {
  window.history.replaceState(null, '', `/${search}`);
}

describe('openSessionInUrl', () => {
  test('selects the session and keeps the folder', () => {
    go('?folderId=3&sessionId=old&subagent=9');
    expect(openSessionInUrl('new-session')).toBe(true);
    const url = new URL(window.location.href);
    expect(url.searchParams.get('sessionId')).toBe('new-session');
    expect(url.searchParams.get('folderId')).toBe('3');
    expect(url.searchParams.has('subagent')).toBe(false);
  });

  test('tells the router the URL moved', () => {
    go('?sessionId=old');
    let events = 0;
    const listener = () => { events += 1; };
    window.addEventListener('popstate', listener);
    openSessionInUrl('next');
    window.removeEventListener('popstate', listener);
    expect(events).toBe(1);
  });

  test('a blank id changes nothing', () => {
    go('?sessionId=keep');
    expect(openSessionInUrl('   ')).toBe(false);
    expect(window.location.search).toBe('?sessionId=keep');
  });
});

describe('window.__kabmoOpenSession', () => {
  test('the installed dispatcher is the same navigation', () => {
    installOpenSessionDispatcher();
    go('?sessionId=old');
    expect(window.__kabmoOpenSession?.('from-notification')).toBe(true);
    expect(new URL(window.location.href).searchParams.get('sessionId')).toBe('from-notification');
  });
});
