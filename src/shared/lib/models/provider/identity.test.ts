/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Antigravity reaches Kabmo under two slugs — omp's `google-antigravity` and
 * the CLI plugin's `antigravity-cli` — and one predicate decides both. A false
 * negative is visible, not silent: the quota rows lose their per-family
 * sections and a local sign-in gets a second row beside the existing one.
 */

import { describe, expect, test } from 'bun:test';

import { isAntigravityProviderSlug } from '@/shared/lib/models/provider/identity';

describe('isAntigravityProviderSlug', () => {
  test('both shipped slugs are Antigravity', () => {
    expect(isAntigravityProviderSlug('google-antigravity')).toBe(true);
    expect(isAntigravityProviderSlug('antigravity-cli')).toBe(true);
    expect(isAntigravityProviderSlug('antigravity')).toBe(true);
  });

  test('spelling variants and surrounding space do not matter', () => {
    expect(isAntigravityProviderSlug('  Google_Antigravity ')).toBe(true);
    expect(isAntigravityProviderSlug('my-antigravity-account')).toBe(true);
  });

  test('another provider is not, including a look-alike mention in a slug', () => {
    expect(isAntigravityProviderSlug('google-gemini-cli')).toBe(false);
    expect(isAntigravityProviderSlug('openai-codex')).toBe(false);
    expect(isAntigravityProviderSlug('')).toBe(false);
  });
});
