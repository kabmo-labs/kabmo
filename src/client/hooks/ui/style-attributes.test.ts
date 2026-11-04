/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two style attributes on `<html>`.
 *
 * Both writers exist because the value reaches CSS through the document, not a
 * prop — so the facts worth pinning are the ones a wrong implementation breaks
 * silently: the default must CLEAR the attribute (a document carrying it and a
 * document not carrying it have to be the same state), an unknown stored value
 * must not produce an attribute no rule matches, and the boot path must read
 * the primed settings snapshot rather than hardcode the default.
 *
 * The settings client keeps a module-level snapshot, so each case primes it
 * explicitly instead of relying on file order.
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { applyIconStyle, initIconStyle } from '@/client/hooks/ui/icon-style';
import { applySurfaceStyle, initSurfaceStyle } from '@/client/hooks/ui/surface-style';
import { primeKabmoSettings } from '@/shared/lib/settings/client';
import { DEFAULT_SETTINGS } from '@/shared/lib/settings/defaults';
import { SURFACE_STYLE_SETTING_KEY } from '@/shared/lib/theme/surface-style';
import { ICON_STYLE_SETTING_KEY } from '@/shared/lib/theme/icon-style';

const DOM_GLOBALS = ['window', 'document'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

beforeEach(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = win[key as keyof Window];
    target[key] = win[key as keyof Window];
  }
  document.documentElement.removeAttribute('data-surface');
  document.documentElement.removeAttribute('data-icon-style');
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (key in nativeGlobals) target[key] = nativeGlobals[key];
    else delete target[key];
  }
});

describe('the stored keys', () => {
  // The setting key and the `SettingsState` field must be the same string for a
  // write to survive a reload: a mismatch saves under one name and reads the
  // other. `defaults.ts` proves the FIELDS exist; this proves the KEYS name them.
  test('each key names a real settings field', () => {
    expect(Object.keys(DEFAULT_SETTINGS)).toContain(SURFACE_STYLE_SETTING_KEY);
    expect(Object.keys(DEFAULT_SETTINGS)).toContain(ICON_STYLE_SETTING_KEY);
  });
});

describe('applySurfaceStyle', () => {
  test('writes the non-default style as the attribute CSS keys on', () => {
    applySurfaceStyle('glass');

    expect(document.documentElement.getAttribute('data-surface')).toBe('glass');
  });

  test('the default CLEARS the attribute instead of writing it', () => {
    applySurfaceStyle('glass');
    applySurfaceStyle('classic');

    expect(document.documentElement.hasAttribute('data-surface')).toBe(false);
  });

  test('an unknown value resolves to the default rather than an unmatched rule', () => {
    applySurfaceStyle('liquid');

    expect(document.documentElement.hasAttribute('data-surface')).toBe(false);
  });
});

describe('applyIconStyle', () => {
  test('writes colour mode', () => {
    applyIconStyle('color');

    expect(document.documentElement.getAttribute('data-icon-style')).toBe('color');
  });

  test('monochrome is the absence of the attribute', () => {
    applyIconStyle('color');
    applyIconStyle('monochrome');

    expect(document.documentElement.hasAttribute('data-icon-style')).toBe(false);
  });
});

describe('the boot path', () => {
  test('a stored glass style is applied from the primed snapshot', () => {
    primeKabmoSettings({ kabmo_settings: { surfaceStyle: 'glass' } });
    initSurfaceStyle();

    expect(document.documentElement.getAttribute('data-surface')).toBe('glass');
  });

  test('a stored colour style is applied from the primed snapshot', () => {
    primeKabmoSettings({ kabmo_settings: { iconStyle: 'color' } });
    initIconStyle();

    expect(document.documentElement.getAttribute('data-icon-style')).toBe('color');
  });

  test('an install with no stored preference boots opaque and monochrome', () => {
    primeKabmoSettings({});
    initSurfaceStyle();
    initIconStyle();

    expect(document.documentElement.hasAttribute('data-surface')).toBe(false);
    expect(document.documentElement.hasAttribute('data-icon-style')).toBe(false);
  });
});
