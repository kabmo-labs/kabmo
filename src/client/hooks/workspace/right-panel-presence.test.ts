/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `useRightPanelPresence` — the side's toggle, and the refusal that answers it.
 *
 * The panel is the only part of the side that can be refused (the editor column
 * keeps its width whenever it is open), so the toggle has to read PRESENCE
 * rather than its own `hidden` flag, and a click that could only flip a flag the
 * layout is ignoring must be answered out loud. Three behaviours, each a bug
 * that shipped before this hook existed:
 *
 * - a load that starts narrow does not warn — the panel was never on screen, and
 *   a toast on every 900px load is noise;
 * - a crossing AFTER the load does warn, once, naming what would make it fit;
 * - a click on a side with nothing on screen is answered even though no crossing
 *   happened.
 *
 * The settle window is a clock read (`Date.now()`), so time is driven with
 * `setSystemTime` rather than by sleeping through it.
 */

import { afterAll, afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import {
  useRightPanelPresence,
  type RightPanelPresence,
} from '@/client/hooks/workspace/right-panel-presence';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

interface ProbeProps {
  showEditor: boolean;
  sideShown: boolean;
  toggleSide: () => void;
  pushToast: (message: string, tone?: 'success' | 'error' | 'warning') => void;
  expose: (value: RightPanelPresence) => void;
}

let toasts: string[] = [];
let toggles = 0;
let container: HTMLElement;
/** Past the hook's 1500ms settle window, without waiting for it. */
const AFTER_SETTLE = 5_000;

beforeEach(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  setSystemTime(new Date('2026-01-01T00:00:00Z'));
  toasts = [];
  toggles = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  restoreDomGlobals();
  setSystemTime();
});

afterAll(() => {
  restoreDomGlobals();
  setSystemTime();
});

function Probe({ showEditor, sideShown, toggleSide, pushToast, expose }: ProbeProps) {
  expose(useRightPanelPresence({ showEditor, sideShown, toggleSide, pushToast }));
  return null;
}

const BASE = { showEditor: true, sideShown: true, toggleSide: () => { toggles += 1; } };

function mount() {
  let current: RightPanelPresence | null = null;
  const draw = async (next: Omit<ProbeProps, 'expose' | 'pushToast'>) => {
    await act(async () => {
      render(
        h(Probe, {
          ...next,
          pushToast: (message: string) => toasts.push(message),
          expose: (value) => {
            current = value;
          },
        }),
        container,
      );
    });
  };
  return {
    draw,
    get: () => current!,
    /** Move the clock past the settle window, so a report counts as a crossing. */
    passSettleWindow: () => setSystemTime(new Date(Date.now() + AFTER_SETTLE)),
  };
}

describe('useRightPanelPresence', () => {
  test('a load that starts narrow does not warn about the panel it never drew', async () => {
    const probe = mount();
    await probe.draw(BASE);
    await act(async () => probe.get().report(true));

    expect(toasts).toEqual([]);
    expect(probe.get().suppressed).toBe(true);
    // The editor column is still on screen, so the side reads visible.
    expect(probe.get().sideVisible).toBe(true);
  });

  test('a crossing after the settle window warns once, and stops repeating', async () => {
    const probe = mount();
    await probe.draw(BASE);
    probe.passSettleWindow();

    await act(async () => probe.get().report(true));
    await act(async () => probe.get().report(true));
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toContain('right panel needs more room');

    // Coming back and losing it again is a second crossing, so it may speak.
    await act(async () => probe.get().report(false));
    await act(async () => probe.get().report(true));
    expect(toasts).toHaveLength(2);
  });

  test('a click on a side with nothing on screen is refused out loud', async () => {
    const probe = mount();
    await probe.draw({ ...BASE, showEditor: false });
    probe.passSettleWindow();
    await act(async () => probe.get().report(true));

    // Nothing of the side is on screen: the editor is closed and the panel is
    // suppressed, so the toggle must explain instead of flipping a dead flag.
    expect(probe.get().sideVisible).toBe(false);
    await act(async () => probe.get().toggle());
    expect(toggles).toBe(0);
    expect(toasts).toHaveLength(1);
  });

  test('a click with something on screen still toggles', async () => {
    const probe = mount();
    await probe.draw(BASE);
    probe.passSettleWindow();
    await act(async () => probe.get().toggle());

    expect(toggles).toBe(1);
    expect(toasts).toEqual([]);
  });
});
