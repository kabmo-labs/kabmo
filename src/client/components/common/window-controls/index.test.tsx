/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The window controls, rendered only for a shell that has none of its own.
 *
 * Three properties are what this suite exists for, and each fails as a button
 * that looks fine and does nothing:
 *
 * 1. **Nothing in a browser.** There is no shell, so `window.__kabmoCall` does
 *    not exist and a click would be a no-op behind a control that appears to
 *    work.
 * 2. **Nothing on macOS**, whose traffic lights are the system's — a second set
 *    drawn by the page would be two close buttons for one window.
 * 3. **A click issues the shell's own verb.** The window state lives in the
 *    shell, so the only observable here is the command that crossed the bridge.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { WindowControls } from '@/client/components/common/window-controls';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

type Shell = {
  __kabmoCall?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  __kabmoDesktop?: Record<string, unknown>;
};

const scope = () => globalThis as unknown as { window?: Shell };

let win: Window;
let container: HTMLElement;
let calls: string[];

function mount(identity: Record<string, unknown> | null, withBridge: boolean) {
  calls = [];
  const shellWindow = win as unknown as Shell;
  if (withBridge) {
    shellWindow.__kabmoCall = async (method) => {
      calls.push(method);
      return null;
    };
  } else {
    delete shellWindow.__kabmoCall;
  }
  if (identity) shellWindow.__kabmoDesktop = identity;
  else delete shellWindow.__kabmoDesktop;

  win.document.body.innerHTML = '';
  container = win.document.createElement('div') as unknown as HTMLElement;
  win.document.body.appendChild(container as never);
  act(() => {
    render(h(WindowControls, {}), container);
  });
}

const buttons = () => Array.from(container.querySelectorAll('button'));

describe('WindowControls', () => {
  beforeEach(() => {
    win = new Window({ url: 'http://127.0.0.1:3000/' });
    installDomGlobals(win as never);
  });

  afterEach(() => {
    restoreDomGlobals();
    delete scope().window;
  });

  test('three buttons, each with an accessible name', () => {
    mount({ platform: 'windows', shellVersion: '0.1.0', overlayTitlebar: true, windowControls: true }, true);
    const labels = buttons().map((button) => button.getAttribute('aria-label'));
    expect(labels).toEqual(['Minimize', 'Maximize', 'Close']);
    // An icon-only control with no title is a tooltip-less button.
    expect(buttons().every((button) => Boolean(button.getAttribute('title')))).toBe(true);
  });

  test('a click issues the shell’s own verb', () => {
    mount({ platform: 'windows', shellVersion: '0.1.0', overlayTitlebar: true, windowControls: true }, true);
    for (const button of buttons()) {
      act(() => {
        button.dispatchEvent(new win.MouseEvent('click', { bubbles: true }) as never);
      });
    }
    expect(calls).toEqual(['window_minimize', 'window_maximize', 'window_close']);
  });

  /** The label follows the click, so a maximised window does not say "Maximize". */
  test('the maximize button reads Restore after a click', () => {
    mount({ platform: 'windows', shellVersion: '0.1.0', overlayTitlebar: true, windowControls: true }, true);
    const maximize = buttons()[1];
    expect(maximize.getAttribute('aria-label')).toBe('Maximize');
    act(() => {
      maximize.dispatchEvent(new win.MouseEvent('click', { bubbles: true }) as never);
    });
    expect(buttons()[1].getAttribute('aria-label')).toBe('Restore');
  });

  /** A bridge that is missing must not throw out of a click handler. */
  test('a click without a bridge is inert', () => {
    mount(null, false);
    expect(() => {
      act(() => {
        buttons()[0].dispatchEvent(new win.MouseEvent('click', { bubbles: true }) as never);
      });
    }).not.toThrow();
    expect(calls).toEqual([]);
  });
});
