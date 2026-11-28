/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Cold-start session continuity, from the page's side.
 *
 * The two halves are invisible when wrong: a restore that ignores the shell
 * leaves every relaunch on the empty workspace, and a restore that overrides an
 * explicit deep link opens the wrong chat. The recorder's failure mode is the
 * same shape one launch later — the app remembers a session the user never
 * opened, or loses the one they did.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import {
  restoreLastOpenedSession,
  useSessionOpenRecorder,
} from '@/client/hooks/shell/last-opened-session';

const nativeFetch = globalThis.fetch;
let container: HTMLElement | undefined;
let requests: string[];

function pointAt(search: string): void {
  window.history.replaceState(null, '', `/${search}`);
  window.dispatchEvent(new Event('popstate'));
}

function asDesktopShell(): void {
  (window as unknown as Record<string, unknown>).__kabmoDesktop = {
    platform: 'macos',
    shellVersion: '0.0.0',
    overlayTitlebar: true,
  };
  // The desktop trio installs BOTH, and `hasShellBridge` asks the transport —
  // the identity alone is what draws the titlebar, not what answers commands.
  (window as unknown as Record<string, unknown>).__kabmoCall = async () => null;
}

function asBrowser(): void {
  const win = window as unknown as Record<string, unknown>;
  delete win.__kabmoDesktop;
  delete win.kabmoHost;
  delete win.webkit;
  delete win.__kabmoCall;
  delete win.__kabmoShellHost;
}

function Probe({ enabled }: { enabled: boolean }) {
  useSessionOpenRecorder(enabled);
  return null;
}

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost/' }));
});

beforeEach(() => {
  pointAt('');
  asBrowser();
  requests = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requests.push(String(input));
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
    container = undefined;
  }
  asBrowser();
});

afterAll(() => {
  pointAt('');
  globalThis.fetch = nativeFetch;
  restoreDomGlobals();
});

describe('restoreLastOpenedSession', () => {
  test('a browser keeps its landing', () => {
    expect(restoreLastOpenedSession('session-a')).toBe(false);
    expect(window.location.search).toBe('');
  });

  test('a desktop shell selects the remembered session without adding history', () => {
    asDesktopShell();
    const before = window.history.length;
    expect(restoreLastOpenedSession('session-a')).toBe(true);
    expect(new URL(window.location.href).searchParams.get('sessionId')).toBe('session-a');
    expect(window.history.length).toBe(before);
  });

  test('a phone shell selects it too', () => {
    (window as unknown as Record<string, unknown>).kabmoHost = { post: () => {} };
    expect(restoreLastOpenedSession('session-b')).toBe(true);
    expect(new URL(window.location.href).searchParams.get('sessionId')).toBe('session-b');
  });

  test('an explicit deep link wins over the remembered session', () => {
    asDesktopShell();
    pointAt('?sessionId=mine');
    expect(restoreLastOpenedSession('remembered')).toBe(false);
    expect(new URL(window.location.href).searchParams.get('sessionId')).toBe('mine');
  });

  test('nothing remembered and nothing valid change nothing', () => {
    asDesktopShell();
    expect(restoreLastOpenedSession(null)).toBe(false);
    expect(restoreLastOpenedSession('   ')).toBe(false);
    expect(window.location.search).toBe('');
  });
});

describe('useSessionOpenRecorder', () => {
  function mount(enabled: boolean): void {
    container = document.createElement('div');
    document.body.append(container);
    act(() => render(h(Probe, { enabled }), container!));
  }

  test('records the selected session once', async () => {
    pointAt('?sessionId=session-a');
    await act(async () => mount(true));
    expect(requests).toEqual(['/api/sessions/session-a/opened']);

    // A re-render for the same selection must not repeat the write.
    await act(async () => render(h(Probe, { enabled: true }), container!));
    expect(requests).toHaveLength(1);
  });

  test('skips a pending chat and records the adopted id', async () => {
    pointAt('?sessionId=new-1761000000000');
    await act(async () => mount(true));
    expect(requests).toEqual([]);

    await act(async () => pointAt('?sessionId=adopted'));
    expect(requests).toEqual(['/api/sessions/adopted/opened']);
  });

  test('a different session is recorded', async () => {
    pointAt('?sessionId=session-a');
    await act(async () => mount(true));
    await act(async () => pointAt('?sessionId=session-b'));
    expect(requests).toEqual([
      '/api/sessions/session-a/opened',
      '/api/sessions/session-b/opened',
    ]);
  });

  test('an unauthenticated screen records nothing', async () => {
    pointAt('?sessionId=session-a');
    await act(async () => mount(false));
    expect(requests).toEqual([]);
  });
});
