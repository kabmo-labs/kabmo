/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The terminal's WebGL context: held while the panel is on screen, released when
 * it is not.
 *
 * The measured reason is in `webgl.ts` — 541.8 MB of `owned unmapped (graphics)`
 * in an 817.7 MB footprint, with a 12.6 MB JS heap. What this file pins is the
 * lifecycle, because every failure here is silent: a context that is never
 * released is invisible until the machine is short of memory, and one released
 * while the panel is still visible drops powerline glyphs back to the DOM
 * renderer's notched version with no error.
 */

import { describe, expect, test } from 'bun:test';
import type { Terminal } from '@xterm/xterm';
import { createWebglControl } from '@/client/components/workspace/terminal-panel/webgl';

/** A terminal double: records addons, and can refuse the context like a driver. */
function fakeTerminal(options: { failLoad?: boolean } = {}) {
  const loaded: string[] = [];
  const term = {
    loadAddon: (addon: { marker?: string }) => {
      if (options.failLoad) throw new Error('no GPU context');
      loaded.push(addon.marker ?? 'addon');
    },
  } as unknown as Terminal;
  return { term, loaded };
}

describe('createWebglControl', () => {
  test('attaching loads the addon exactly once', async () => {
    const { term, loaded } = fakeTerminal();
    const control = await createWebglControl(term);
    control.attach();
    control.attach();
    expect(loaded.length).toBe(1);
  });

  test('detaching releases it, and attaching again creates a NEW context', async () => {
    const { term, loaded } = fakeTerminal();
    const control = await createWebglControl(term);
    control.attach();
    control.detach();
    control.detach();
    control.attach();
    // Two loads, because the second attach must not reuse a disposed addon: a
    // disposed WebGL renderer draws nothing.
    expect(loaded.length).toBe(2);
  });

  test('`set` is the same lifecycle, so a panel mounted hidden stays released', async () => {
    const { term, loaded } = fakeTerminal();
    const control = await createWebglControl(term);
    control.set(false);
    expect(loaded.length).toBe(0);
    control.set(true);
    expect(loaded.length).toBe(1);
    control.set(false);
    control.set(true);
    expect(loaded.length).toBe(2);
  });

  test('a driver that refuses the context leaves the DOM renderer in place', async () => {
    const { term } = fakeTerminal({ failLoad: true });
    const control = await createWebglControl(term);
    // Must not throw: a machine with no GPU context still renders the terminal.
    expect(() => control.attach()).not.toThrow();
    // And a later detach is a no-op rather than a second throw.
    expect(() => control.detach()).not.toThrow();
  });
});
