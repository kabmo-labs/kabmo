/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The desktop footer's version stamp.
 *
 * The phone footer has always shown `v<version>`; the desktop strip did not, so
 * the same build reported its version in one layout and not the other. This
 * pins the stamp and the fact that it survives the update pill appearing beside
 * it — the pill is conditional, and a right-hand group that only exists when
 * there is an update would drop the version on every up-to-date build.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import packageJson from '@/../package.json';
import { SessionSidebarFooter } from '@/client/components/layout/session-sidebar/Footer';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let container: HTMLElement;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

async function mount(node: preact.ComponentChild) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(node, container);
  });
  return container;
}

const noop = () => {};

describe('desktop session sidebar footer', () => {
  test('draws the build version with no update pending', async () => {
    const el = await mount(h(SessionSidebarFooter, { onSettings: noop, onKeyBindings: noop, onInfo: noop }));
    expect(el.textContent).toContain(`v${packageJson.version}`);
    expect(el.textContent).not.toContain('update');
  });

  test('keeps the version beside the update pill', async () => {
    const el = await mount(
      h(SessionSidebarFooter, { onSettings: noop, onKeyBindings: noop, onInfo: noop, updateAvailable: true, onUpdateClick: noop }),
    );
    expect(el.textContent).toContain(`v${packageJson.version}`);
    expect(el.textContent).toContain('update');
  });

  // The layout switch lives in the footer on BOTH layouts: the phone draws
  // "Desktop" here, so the desktop's "mobile view" is the mirror control in the
  // same slot rather than a button in the top navbar.
  test('draws the layout switch only when the caller offers one', async () => {
    const without = await mount(h(SessionSidebarFooter, { onSettings: noop, onKeyBindings: noop, onInfo: noop }));
    expect(without.querySelector('button[aria-label="Switch to mobile view"]')).toBeNull();

    render(null, without);
    without.remove();

    let presses = 0;
    const withSwitch = await mount(
      h(SessionSidebarFooter, { onSettings: noop, onKeyBindings: noop, onInfo: noop, onMobileToggle: () => { presses += 1; } }),
    );
    const control = withSwitch.querySelector('button[aria-label="Switch to mobile view"]') as HTMLElement | null;
    expect(control).toBeTruthy();
    control!.click();
    expect(presses).toBe(1);
  });
});
