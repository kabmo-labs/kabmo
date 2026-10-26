/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The page's answer to `window.__kabmoPalette()`.
 *
 * The property is the ONLY channel a native shell has for "what palette is this
 * console painting", and it is asked on the load that hides the overlay — so a
 * missing installer, or an answer captured before a theme change, leaves every
 * shell on the palette it stored on a previous launch. Both are silent in a
 * browser, which is why they are pinned here.
 *
 * Runs against a real DOM (happy-dom) because the installer writes `window` and
 * the answer is read back from it; nothing here touches a global at evaluation
 * time, so the static import is safe.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import { activeShellPalette, installPalettePublisher } from '@/client/lib/native/palette';
import {
  SHELL_PALETTE_PROPERTY,
  parseShellPaletteWire,
  shellPalette,
  shellPaletteWire,
} from '@/shared/lib/theme/shell-palette';

const displaced: Record<string, unknown> = {};
let dom: Window;

beforeAll(() => {
  for (const key of ['window', 'document'] as const) displaced[key] = (globalThis as Record<string, unknown>)[key];
  dom = new Window({ url: 'http://127.0.0.1:3000/' });
  (globalThis as Record<string, unknown>).window = dom;
  (globalThis as Record<string, unknown>).document = dom.document;
});

afterAll(() => {
  for (const [key, value] of Object.entries(displaced)) {
    if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
    else (globalThis as Record<string, unknown>)[key] = value;
  }
});

function answer(): unknown {
  const callable = (window as unknown as Record<string, unknown>)[SHELL_PALETTE_PROPERTY];
  return typeof callable === 'function' ? (callable as () => unknown)() : undefined;
}

function withTheme(id: string, body: () => void): void {
  const root = document.documentElement;
  const previous = root.getAttribute('data-theme');
  root.setAttribute('data-theme', id);
  try {
    body();
  } finally {
    if (previous === null) root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', previous);
  }
}

describe('installPalettePublisher', () => {
  test('installs the property the shells call', () => {
    installPalettePublisher();
    expect(typeof (window as unknown as Record<string, unknown>)[SHELL_PALETTE_PROPERTY]).toBe('function');
  });

  test('answers the WIRE string, which every native parser can read', () => {
    installPalettePublisher();
    withTheme('one-dark-pro-soft', () => {
      const wire = answer();
      expect(typeof wire).toBe('string');
      // Round-trips through the same parser the shells implement.
      expect(parseShellPaletteWire(wire as string)).toEqual(shellPalette('one-dark-pro-soft'));
    });
  });

  test('answers the palette on the document at CALL time, not at install time', () => {
    installPalettePublisher();
    // A theme picked in Settings must reach the next launch with no reload, so
    // the read cannot be captured when the installer ran.
    withTheme('one-dark-pro-soft', () => {
      expect(answer()).toBe(shellPaletteWire(shellPalette('one-dark-pro-soft')));
    });
    withTheme('paper', () => {
      expect(answer()).toBe(shellPaletteWire(shellPalette('paper')));
    });
  });

  test('is idempotent, so a hot reload cannot leave two installers disagreeing', () => {
    installPalettePublisher();
    const first = (window as unknown as Record<string, unknown>)[SHELL_PALETTE_PROPERTY];
    installPalettePublisher();
    expect((window as unknown as Record<string, unknown>)[SHELL_PALETTE_PROPERTY]).toBe(first);
  });

  test('the object form and the wire form describe the same palette', () => {
    installPalettePublisher();
    withTheme('one-dark-pro-soft', () => {
      expect(parseShellPaletteWire(answer() as string)).toEqual(activeShellPalette());
    });
  });
});
