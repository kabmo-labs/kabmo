/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The regression this pins: a password-protected install drew its login screen
 * in the shipped default palette because the shell gated the STORED settings on
 * `authenticated` — while the workspace behind the password used the chosen
 * one. Presentation is not a secret; only the published map is.
 */

import { describe, expect, test } from 'bun:test';
import { splitShellSettings } from '@/server/lib/assets/shell-settings.server';
import { readSettingsBlob } from '@/shared/lib/settings/keys';

const STORED = {
  kabmo_settings: { theme: 'one-dark-pro-soft', surfaceStyle: 'glass' },
  omp_provider_registry: { secret: 'must-not-leak' },
};

describe('splitShellSettings', () => {
  test('an unauthenticated visitor still paints the stored theme', () => {
    const split = splitShellSettings(STORED, false);
    expect(readSettingsBlob(split.presentation).theme).toBe('one-dark-pro-soft');
  });

  test('an unauthenticated visitor is published no settings at all', () => {
    expect(splitShellSettings(STORED, false).published).toEqual({});
  });

  test('an authenticated request publishes the whole map', () => {
    expect(splitShellSettings(STORED, true).published).toBe(STORED);
  });
});
