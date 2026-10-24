/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The desktop self-update's client half.
 *
 * Two facts are pinned here and both were decisions rather than accidents:
 *
 * 1. **Which offers the shell can install itself** — a FILE (`direct`) in a
 *    DESKTOP shell. An Android offer installs through `PackageInstaller` (its own
 *    path), an iOS one cannot install at all, and a browser has no shell to ask.
 * 2. **A failure is reported, never swallowed.** The shell's own sentence is what
 *    a user can act on, and a run that reported success before the shell said so
 *    would be a lie about an app that is still on the old build.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { canSelfUpdate, useShellUpdate } from '@/client/hooks/ui/updates/shell-update';
import type { ShellDownload } from '@/client/hooks/ui/updates/shell-download';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const DESKTOP: ShellDownload = {
  url: 'https://x/Kabmo-1.2.3-mac-arm64.zip',
  latest: '1.2.3',
  releaseUrl: 'https://x/app',
  direct: true,
  kind: 'update',
  platform: 'macos',
};

const PAGE: ShellDownload = { ...DESKTOP, url: 'https://x/app', direct: false };

let container: HTMLElement;

/** Install (or remove) a bridge on the page. */
function bridge(call: ((method: string, params?: Record<string, unknown>) => Promise<unknown>) | null): void {
  const page = globalThis as unknown as { window: { __kabmoCall?: unknown } };
  if (call) page.window.__kabmoCall = call;
  else delete page.window.__kabmoCall;
}

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => render(null, container));
  bridge(null);
});

afterAll(() => {
  container.remove();
  restoreDomGlobals();
});

describe('canSelfUpdate', () => {
  test('a direct desktop offer inside the shell is installable', () => {
    bridge(async () => null);
    expect(canSelfUpdate(DESKTOP)).toBe(true);
    expect(canSelfUpdate({ ...DESKTOP, platform: 'windows' })).toBe(true);
    expect(canSelfUpdate({ ...DESKTOP, platform: 'linux' })).toBe(true);
  });

  test('a release PAGE is not installable, whatever the platform', () => {
    bridge(async () => null);
    // The console could not name a file, so there is nothing to hand the shell.
    expect(canSelfUpdate(PAGE)).toBe(false);
  });

  test('the mobile shells keep their own paths', () => {
    bridge(async () => null);
    // Android installs through PackageInstaller, iOS cannot install at all.
    expect(canSelfUpdate({ ...DESKTOP, platform: 'android' })).toBe(false);
    expect(canSelfUpdate({ ...DESKTOP, platform: 'ios' })).toBe(false);
  });

  test('a browser has no shell to ask', () => {
    bridge(null);
    expect(canSelfUpdate(DESKTOP)).toBe(false);
  });

  test('an absent offer is not installable', () => {
    bridge(async () => null);
    expect(canSelfUpdate(null)).toBe(false);
    expect(canSelfUpdate(undefined)).toBe(false);
  });
});

describe('useShellUpdate', () => {
  /** A harness that exposes the hook's state and its one action. */
  function Harness({ run }: { run: boolean }) {
    const state = useShellUpdate();
    if (run && state.phase === 'idle') void state.apply(DESKTOP);
    return h('span', { id: 'state' }, `${state.phase}:${state.message ?? ''}`);
  }

  async function mount(run: boolean): Promise<string> {
    await act(async () => {
      render(h(Harness, { run }), container);
    });
    for (let i = 0; i < 20; i += 1) await act(async () => {});
    return container.querySelector('#state')?.textContent ?? '';
  }

  test('passes the offer to the shell, and reports its own sentence', async () => {
    const calls: { method: string; params?: Record<string, unknown> }[] = [];
    bridge(async (method, params) => {
      calls.push({ method, params });
      return { success: true, version: '1.2.3', message: 'Kabmo 1.2.3 installed — restarting.', relaunching: true };
    });

    expect(await mount(true)).toBe('done:Kabmo 1.2.3 installed — restarting.');
    expect(calls).toEqual([
      { method: 'update_apply', params: { url: DESKTOP.url, version: DESKTOP.latest } },
    ]);
  });

  test('a refused update keeps the shell’s reason', async () => {
    // The shell verified the bytes and declined: "the downloaded file is not a
    // signed Kabmo build" is the only thing that tells a user what to do next.
    bridge(async () => ({ success: false, message: 'The downloaded file is not a signed Kabmo build.' }));

    expect(await mount(true)).toBe('error:The downloaded file is not a signed Kabmo build.');
  });

  test('a shell that cannot answer is reported rather than assumed to have worked', async () => {
    bridge(async () => {
      throw new Error('Unknown shell command: update_apply');
    });

    expect(await mount(true)).toBe('error:Unknown shell command: update_apply');
  });
});
