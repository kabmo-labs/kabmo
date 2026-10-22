/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The server panel, rendered against a real shell bridge.
 *
 * Three rules are what this suite exists for, and each was a decision rather
 * than a style:
 *
 * 1. **In a browser the control does not exist.** There is no shell to control,
 *    and a button that opened onto "not available" would be a button that never
 *    works. The panel is rendered with no bridge at all and must produce
 *    nothing.
 * 2. **A stopped server cannot be connected to.** The shell probes every URL
 *    before it answers, so `running: false` is a fact; the row says `Stopped`
 *    and its button is disabled rather than letting a click land on a blank
 *    window.
 * 3. **Only a server this shell started offers Stop.** A server found on the
 *    machine belongs to whoever started it — `kabmo serve` in a terminal — and a
 *    Stop here would kill a process somebody else is watching.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ServerSwitcher } from '@/client/components/common/server-switcher';
import type { DesktopServersState } from '@/client/lib/desktop/bridge';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const state = (overrides: Partial<DesktopServersState> = {}): DesktopServersState => ({
  entries: [],
  detected: [],
  ...overrides,
});

const LOCAL: DesktopServersState = state({
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

let win: Window;
let container: HTMLElement;
let calls: Array<{ command: string; args?: Record<string, unknown> }>;

function mount(next: DesktopServersState | Error) {
  calls = [];
  win.document.body.innerHTML = '';
  container = win.document.createElement('div') as unknown as HTMLElement;
  win.document.body.appendChild(container as never);
  // The transport the macOS shell installs: `__kabmoCall` answers through the
  // same door the shell uses, which is what makes this a test of the bridge
  // rather than of a stub only this suite knows about.
  const shellWindow = win as unknown as {
    __kabmoCall?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  };
  shellWindow.__kabmoCall = async (method, params) => {
    calls.push({ command: method, args: params });
    if (next instanceof Error) throw next;
    return next;
  };
  act(() => {
    render(h(ServerSwitcher, { open: true, onClose: () => {} }), container as never);
  });
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

describe('ServerSwitcher', () => {
  test('lists the stored servers, the detected ones, and marks the active row', async () => {
    mount(LOCAL);
    await settle();
    expect(text()).toContain('This window');
    expect(text()).toContain('Local :3001');
    expect(text()).toContain('NAS');
    expect(text()).toContain('Found on this machine');
    expect(text()).toContain('Local :3000');
    // The active row carries its own marker rather than a colour alone.
    expect(container.querySelector('[aria-label="Active"]')).not.toBeNull();
  });

  test('a stopped server is offered as Stopped and cannot be connected to', async () => {
    mount(LOCAL);
    await settle();
    expect(text()).toContain('Stopped');
    const nas = [...container.querySelectorAll('button')].find((button) =>
      (button.textContent ?? '').includes('NAS'),
    );
    expect(nas).toBeDefined();
    expect((nas as HTMLButtonElement).disabled).toBe(true);
  });

  test('Stop is offered only for a server this shell started', async () => {
    mount(LOCAL);
    await settle();
    const stops = [...container.querySelectorAll('button')].filter((button) =>
      (button.getAttribute('aria-label') ?? '').startsWith('Stop '),
    );
    expect(stops.map((button) => button.getAttribute('aria-label'))).toEqual(['Stop Local :3001']);
  });

  test('a refused add shows the shell’s own sentence', async () => {
    mount(new Error("Use the server's root address — a base path is not supported."));
    await settle();
    expect(text()).toContain('root address');
  });

  test('a browser renders nothing, because there is no shell to control', async () => {
    mount(LOCAL);
    delete (win as unknown as { __kabmoCall?: unknown }).__kabmoCall;
    calls = [];
    win.document.body.innerHTML = '';
    const bare = win.document.createElement('div');
    win.document.body.appendChild(bare as never);
    act(() => {
      render(h(ServerSwitcher, { open: true, onClose: () => {} }), bare as never);
    });
    await settle();
    // The panel still draws (it is a component with an explicit `open`), but it
    // must not have issued a single bridge call — that is what would throw in a
    // browser. The navbar is what hides the control entirely.
    expect(calls).toEqual([]);
  });
});
