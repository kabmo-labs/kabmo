/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The server panel, rendered against a real shell bridge.
 *
 * Four rules are what this suite exists for, and each was a decision rather
 * than a style:
 *
 * 1. **A stopped server cannot be connected to.** The shell probes every URL
 *    before it answers, so `running: false` is a fact; the row says `Stopped`
 *    and its button is disabled rather than letting a click land on a blank
 *    window.
 * 2. **Only a server this shell started offers Stop.** A server found on the
 *    machine belongs to whoever started it — `kabmo serve` in a terminal — and a
 *    Stop here would kill a process somebody else is watching.
 * 3. **A phone is offered no Start.** `startable: false` is the fact the shell
 *    reports, and the control is ABSENT rather than disabled: a disabled button
 *    would promise a capability the phone does not have.
 * 4. **The trigger and the panel share ONE store.** Two copies is how a trigger
 *    says "running" over rows that say `Stopped`, and how two 4-second polls
 *    probe every server twice.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ServerControl } from '@/client/components/common/server-control';
import { MobileSessionHeader } from '@/client/components/mobile/mobile-session-sidebar/Header';
import type { ShellServersState } from '@/client/lib/shell/servers';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const state = (overrides: Partial<ShellServersState> = {}): ShellServersState => ({
  entries: [],
  detected: [],
  ...overrides,
});

const LOCAL: ShellServersState = state({
  entries: [
    { id: 'local:3001', label: 'Local :3001', url: 'http://127.0.0.1:3001', kind: 'managed', port: 3001, running: true, owned: true, version: '0.5.3', mode: 'prod', pid: 42, source: 'stored' },
    { id: 'remote:https://nas:8443', label: 'NAS', url: 'https://nas:8443', kind: 'remote', running: false, owned: false, source: 'stored' },
  ],
  detected: [
    { id: 'local:3000', label: 'Local :3000', url: 'http://127.0.0.1:3000', kind: 'managed', port: 3000, running: true, owned: false, version: '0.5.3', mode: 'dev', pid: 7, source: 'record' },
  ],
  activeId: 'local:3001',
  activeUrl: 'http://127.0.0.1:3001',
});

/** What the three desktop shells answer: they can start a server of their own. */
const DESKTOP = LOCAL;

/** What a phone answers: no spawning, no per-port records on the device. */
const PHONE: ShellServersState = state({
  entries: [
    { id: 'local:3001', label: 'Home NAS', url: 'http://192.168.1.10:3000', kind: 'remote', running: true, owned: false, version: '0.5.3', source: 'stored' },
    { id: 'remote:https://office', label: 'Office', url: 'https://office.example:3000', kind: 'remote', running: false, owned: false, source: 'stored' },
  ],
  activeId: 'local:3001',
  activeUrl: 'http://192.168.1.10:3000',
  startable: false,
});

let win: Window;
let container: HTMLElement;
let calls: Array<{ command: string; args?: Record<string, unknown> }>;

function mount(next: ShellServersState | Error, variant: 'nav' | 'chip' = 'nav', open = true) {
  calls = [];
  win.document.body.innerHTML = '';
  container = win.document.createElement('div') as unknown as HTMLElement;
  win.document.body.appendChild(container as never);
  // The transport the shells install: `__kabmoCall` answers through the same
  // door the shell uses, which is what makes this a test of the bridge rather
  // than of a stub only this suite knows about.
  const shellWindow = win as unknown as {
    __kabmoCall?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  };
  shellWindow.__kabmoCall = async (method, params) => {
    calls.push({ command: method, args: params });
    if (next instanceof Error) throw next;
    return next;
  };
  act(() => {
    render(h(ServerControl, { variant }), container as never);
  });
  if (open) {
    const trigger = container.querySelector('button');
    act(() => {
      (trigger as HTMLButtonElement | null)?.click();
    });
  }
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const text = () => (container.textContent ?? '').replace(/\s+/g, ' ').trim();

beforeEach(() => {
  win = new Window({ url: 'http://127.0.0.1:3001/' });
  installDomGlobals(win);
});

afterEach(() => {
  if (container) act(() => render(null, container as never));
  restoreDomGlobals();
});

describe('ServerControl', () => {
  test('a browser renders nothing, because there is no shell to control', async () => {
    win.document.body.innerHTML = '';
    const bare = win.document.createElement('div');
    win.document.body.appendChild(bare as never);
    act(() => {
      render(h(ServerControl, { variant: 'chip' }), bare as never);
    });
    await settle();
    expect((bare.textContent ?? '').trim()).toBe('');
    expect(bare.querySelector('button')).toBeNull();
  });

  test('lists the stored servers, the detected ones, and marks the active row', async () => {
    mount(DESKTOP);
    await settle();
    expect(text()).toContain('This window');
    expect(text()).toContain('Local :3001');
    expect(text()).toContain('NAS');
    expect(text()).toContain('Found on this machine');
    expect(text()).toContain('Local :3000');
    // The active row carries its own marker rather than a colour alone.
    expect(container.querySelector('[aria-label="Active"]')).not.toBeNull();
  });

  test('the trigger and the panel read ONE list — one read, not two polls', async () => {
    mount(DESKTOP);
    await settle();
    expect(calls.filter((call) => call.command === 'servers_state')).toHaveLength(1);
  });

  test('a stopped server is offered as Stopped and cannot be connected to', async () => {
    mount(DESKTOP);
    await settle();
    expect(text()).toContain('Stopped');
    const nas = [...container.querySelectorAll('button')].find((button) =>
      (button.textContent ?? '').includes('NAS'),
    );
    expect(nas).toBeDefined();
    expect((nas as HTMLButtonElement).disabled).toBe(true);
  });

  test('Stop is offered only for a server this shell started', async () => {
    mount(DESKTOP);
    await settle();
    const stops = [...container.querySelectorAll('button')].filter((button) =>
      (button.getAttribute('aria-label') ?? '').startsWith('Stop '),
    );
    expect(stops.map((button) => button.getAttribute('aria-label'))).toEqual(['Stop Local :3001']);
  });

  test('a phone is offered no Start, and no local discovery', async () => {
    mount(PHONE, 'chip');
    await settle();
    expect(text()).toContain('Home NAS');
    expect(text()).not.toContain('Start a local server');
    expect(text()).not.toContain('Found on this machine');
    // The chip's own accessible name carries the server, since it has no label.
    expect(container.querySelector('[aria-label^="Server: Home NAS"]')).not.toBeNull();
  });

  /**
   * The phone's trigger lives in the DRAWER's title bar, not in the chat header:
   * measured at 390px with a password set, the chat header has ~100px spare and
   * adding 40px left the session title 49px, while this row has ~158px spare.
   */
  test('the drawer header carries the chip, but only inside a shell', async () => {
    const mountHeader = () => {
      win.document.body.innerHTML = '';
      container = win.document.createElement('div') as unknown as HTMLElement;
      win.document.body.appendChild(container as never);
      act(() => {
        render(h(MobileSessionHeader, { onClose: () => {} }), container as never);
      });
    };

    mountHeader();
    await settle();
    expect(container.querySelector('[aria-label="Choose a server"]')).toBeNull();

    (win as unknown as { __kabmoCall?: unknown }).__kabmoCall = async () => state();
    mountHeader();
    await settle();
    expect(container.querySelector('[aria-label="Choose a server"]')).not.toBeNull();
    // The drawer's own control is untouched.
    expect(container.querySelector('[aria-label="Close sidebar"]')).not.toBeNull();
  });

  test('a refused add shows the shell’s own sentence', async () => {
    mount(new Error("Use the server's root address — a base path is not supported."));
    await settle();
    expect(text()).toContain('root address');
  });
});
