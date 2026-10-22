/**
 * The bridge, driven through the transport the macOS shell installs.
 *
 * The interesting failures are about what the page can tell apart: a browser has
 * no shell at all, a shell announces itself before the first render, and a
 * refused command keeps the shell's own sentence. None of that is visible in the
 * panel's markup — a control that never works looks exactly like one that does
 * until it is pressed.
 */

import { describe, expect, test, beforeEach } from 'bun:test';

type Reply = (id: number, ok: boolean, payload: unknown) => void;

interface ShellWindow {
  __kabmoCall?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  __kabmoDesktop?: unknown;
  __kabmoReply?: Reply;
}

const shell = () => globalThis as unknown as { window?: ShellWindow };

describe('desktop bridge', () => {
  beforeEach(() => {
    delete shell().window;
  });

  test('a browser has no shell, and every call refuses', async () => {
    shell().window = {};
    const bridge = await import('@/client/lib/desktop/bridge');
    expect(bridge.isDesktopShell()).toBe(false);
    expect(await bridge.desktopInfo()).toBeNull();
    await expect(bridge.readServers()).rejects.toThrow('Not running inside the Kabmo desktop shell.');
  });

  test('the injected identity is readable before any command runs', async () => {
    shell().window = {
      __kabmoCall: async () => null,
      __kabmoDesktop: { platform: 'macos', shellVersion: '0.1.0', overlayTitlebar: true, trafficLightInset: '5rem' },
    };
    const bridge = await import('@/client/lib/desktop/bridge');
    expect(bridge.isDesktopShell()).toBe(true);
    const info = await bridge.desktopInfo();
    expect(info?.overlayTitlebar).toBe(true);
    expect(info?.trafficLightInset).toBe('5rem');
  });

  test('a command answers through __kabmoCall', async () => {
    const seen: string[] = [];
    shell().window = {
      __kabmoCall: async (method) => {
        seen.push(method);
        return { entries: [], detected: [], activeId: 'local:1' };
      },
    };
    const bridge = await import('@/client/lib/desktop/bridge');
    const state = await bridge.readServers();
    expect(seen).toEqual(['servers_state']);
    expect(state.activeId).toBe('local:1');
  });

  /**
   * The shell sends its own sentence, which is what the UI shows. Stripping a
   * prefix would eat the first word of a message that starts with "Error".
   */
  test('a refused command keeps the shell’s own sentence, unstripped', async () => {
    const bridge = await import('@/client/lib/desktop/bridge');
    expect(bridge.bridgeError(new Error('Use the server’s root address — a base path is not supported.'))).toBe(
      'Use the server’s root address — a base path is not supported.',
    );
    expect(bridge.bridgeError('plain')).toBe('plain');
  });
});
