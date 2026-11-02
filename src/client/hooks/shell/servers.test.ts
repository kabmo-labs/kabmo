/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The shell bridge, driven through three different transports.
 *
 * The interesting failures are about what the page can tell apart:
 *
 * 1. a browser has no shell at all, and every command refuses;
 * 2. a desktop shell installs `__kabmoCall` itself, and answers on the first
 *    paint (`__kabmoDesktop`);
 * 3. a PHONE exposes only a host object, so the console adapts it — and that
 *    adapter must be distinguishable from a desktop, because the titlebar inset
 *    treats "a shell with no identity" as a macOS window.
 *
 * None of it is visible in the panel's markup: a control that never works looks
 * exactly like one that does until it is pressed.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { desktopInfo } from '@/client/lib/shell/desktop';
import { addRemoteServer, readServers } from '@/client/lib/shell/servers';
import {
  bridgeError,
  hasShellBridge,
  installShellTransport,
  isDesktopShell,
  isMobileShell,
  shellHost,
} from '@/client/lib/shell/transport';

type Reply = (id: number, ok: boolean, payload: unknown) => void;

interface ShellWindow {
  __kabmoCall?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  __kabmoDesktop?: unknown;
  __kabmoReply?: Reply;
  __kabmoShellHost?: 'android' | 'ios';
  kabmoHost?: { post: (method: string, id: string, params: string) => void };
  webkit?: { messageHandlers?: { kabmo?: { postMessage: (message: unknown) => void } } };
}

const shell = () => globalThis as unknown as { window?: ShellWindow };

describe('shell bridge', () => {
  beforeEach(() => {
    delete shell().window;
  });

  test('a browser has no shell, and every call refuses', async () => {
    shell().window = {};
    expect(shellHost()).toBeNull();
    expect(hasShellBridge()).toBe(false);
    expect(isDesktopShell()).toBe(false);
    expect(isMobileShell()).toBe(false);
    expect(await desktopInfo()).toBeNull();
    await expect(readServers()).rejects.toThrow('Not running inside a Kabmo shell.');
  });

  test('the injected identity is readable before any command runs', async () => {
    shell().window = {
      __kabmoCall: async () => null,
      __kabmoDesktop: { platform: 'macos', shellVersion: '0.1.0', overlayTitlebar: true, trafficLightInset: '5rem' },
    };
    expect(isDesktopShell()).toBe(true);
    expect(isMobileShell()).toBe(false);
    const info = await desktopInfo();
    expect(info?.overlayTitlebar).toBe(true);
    expect(info?.trafficLightInset).toBe('5rem');
  });

  /**
   * macOS and Linux post over `window.webkit.messageHandlers.kabmo` — the same
   * handler NAME iOS uses — so "is there a WebKit handler?" cannot decide which
   * shell this is. When it did, `isDesktopShell()` answered false in every macOS
   * window, `titlebarInsetLeft` stopped reserving the 5rem for the traffic
   * lights, and the wordmark was drawn under close / minimise / maximise.
   */
  test('a macOS shell is not read as an iPhone, though it posts over the same handler', () => {
    shell().window = {
      __kabmoCall: async () => null,
      __kabmoDesktop: { platform: 'macos', shellVersion: '0.1.0', overlayTitlebar: true, trafficLightInset: '5rem' },
      webkit: { messageHandlers: { kabmo: { postMessage: () => {} } } },
    };
    expect(shellHost()).toBe('desktop');
    expect(isDesktopShell()).toBe(true);
    expect(isMobileShell()).toBe(false);
  });

  test('a command answers through __kabmoCall', async () => {
    const seen: string[] = [];
    shell().window = {
      __kabmoCall: async (method) => {
        seen.push(method);
        return { entries: [], detected: [], activeId: 'local:1' };
      },
    };
    const state = await readServers();
    expect(seen).toEqual(['servers_state']);
    expect(state.activeId).toBe('local:1');
  });

  /**
   * The phone's transport is ADAPTED, not replaced: the native side gets
   * `(method, id, params)` and answers by evaluating `__kabmoReply`, exactly as
   * the desktop shells do. Params are form-encoded because Android's `org.json`
   * is a stub in a JVM unit test, and state comes back as JSON text.
   */
  test('an Android host becomes __kabmoCall, with form-encoded params and JSON text back', async () => {
    const posts: Array<{ method: string; id: string; params: string }> = [];
    shell().window = {
      kabmoHost: {
        post: (method, id, params) => {
          posts.push({ method, id, params });
          // Answer the way the native side does: a JSON TEXT payload, on the
          // next microtask rather than a real timer.
          queueMicrotask(() => {
            shell().window?.__kabmoReply?.(Number(id), true, '{"entries":[],"detected":[],"activeUrl":"http://10.0.0.2:3000"}');
          });
        },
      },
    };
    installShellTransport();
    expect(isMobileShell()).toBe(true);
    // The distinction that matters: a phone is NOT a desktop, or the header
    // would reserve 5rem for traffic lights it does not have.
    expect(isDesktopShell()).toBe(false);
    expect(hasShellBridge()).toBe(true);

    const state = await addRemoteServer('NAS', 'http://10.0.0.2:3000');
    expect(state.activeUrl).toBe('http://10.0.0.2:3000');
    expect(posts).toHaveLength(1);
    expect(posts[0].method).toBe('servers_add');
    expect(posts[0].params).toBe('label=NAS&url=http%3A%2F%2F10.0.0.2%3A3000');
  });

  test('an iOS host posts to the WebKit message handler', async () => {
    const posts: unknown[] = [];
    shell().window = {
      webkit: {
        messageHandlers: {
          kabmo: {
            postMessage: (message) => {
              posts.push(message);
              const { id } = message as { id: number };
              queueMicrotask(() => shell().window?.__kabmoReply?.(id, true, '{"entries":[],"detected":[]}'));
            },
          },
        },
      },
    };
    installShellTransport();
    expect(isMobileShell()).toBe(true);
    await readServers();
    expect(posts).toEqual([{ id: 1, method: 'servers_state', params: '' }]);
  });

  test('a refusal keeps the shell’s own sentence, unstripped', async () => {
    expect(bridgeError(new Error('Use the server’s root address — a base path is not supported.'))).toBe(
      'Use the server’s root address — a base path is not supported.',
    );
    expect(bridgeError('plain')).toBe('plain');
  });
});
