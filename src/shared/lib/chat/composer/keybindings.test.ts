/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The composer's Enter bindings must come out of the `omp_chamber_settings`
 * blob.
 *
 * This is the bug the file exists to pin: the handler read `appSettings
 * .keybindingSend` off the TOP level, where it never is — Settings → Chats →
 * Keybindings persists through `writeKabmoSettings`, which nests under
 * `omp_chamber_settings`. Every binding therefore fell back to its default and
 * the settings panel showed a choice the composer ignored. Measured in the
 * browser: with "send" set to Ctrl+Enter a bare Enter still cleared the draft
 * and started a turn.
 *
 * The snapshot is module state, so each case primes it explicitly and the suite
 * restores the pristine one at the end (the rule `client.test.ts` documents).
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { primeKabmoSettings, writeKabmoSettings } from '@/shared/lib/settings/client';
import {
  DEFAULT_COMPOSER_KEYBINDINGS,
  resolveComposerKeybindings,
} from '@/shared/lib/chat/composer/keybindings';

const BOOTSTRAP = {
  omp_chamber_settings: {
    keybindingSend: 'Ctrl / Cmd + Enter',
    keybindingNewLine: 'Enter',
    keybindingSteering: 'Shift + Enter',
  },
};

beforeEach(() => {
  primeKabmoSettings(BOOTSTRAP);
});

afterAll(() => {
  primeKabmoSettings({});
});

describe('resolveComposerKeybindings', () => {
  test('reads the bindings out of the chamber-settings blob', () => {
    expect(resolveComposerKeybindings()).toEqual({
      send: 'Ctrl / Cmd + Enter',
      newLine: 'Enter',
      steering: 'Shift + Enter',
    });
  });

  test('the blob wins over a stale top-level copy of the same key', () => {
    // The real bootstrap carries no top-level `keybindingSend`, which is
    // exactly why reading one off the top level found nothing. When both are
    // present the blob is the authority — that is where the settings writer
    // puts every edit.
    primeKabmoSettings({ keybindingSend: 'Shift + Enter', omp_chamber_settings: { keybindingSend: 'Ctrl / Cmd + Enter' } });
    expect(resolveComposerKeybindings().send).toBe('Ctrl / Cmd + Enter');
  });

  test('an unset key falls back to the binding the settings editor shows', () => {
    primeKabmoSettings({ omp_chamber_settings: {} });
    expect(resolveComposerKeybindings()).toEqual(DEFAULT_COMPOSER_KEYBINDINGS);
  });

  test('a later write applies without a re-prime', () => {
    // The handler resolves per keypress, so a change made in Settings is live
    // for the next Enter even though nothing re-rendered the composer.
    writeKabmoSettings({ keybindingSend: 'Shift + Enter' });
    expect(resolveComposerKeybindings().send).toBe('Shift + Enter');
  });
});
