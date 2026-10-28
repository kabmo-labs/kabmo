/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';

import { resolveServeMode } from '@/cli/lib/serve-mode.js';

describe('resolveServeMode', () => {
  // The reported behavior: the CLI's own command served the dev entry, so a
  // global install ran the unminified bundle with HMR wired up.
  test('defaults to the production build', () => {
    expect(resolveServeMode({})).toBe('prod');
    expect(resolveServeMode(undefined)).toBe('prod');
  });

  // A server started with `--dev` must come back as one after `restart`, which
  // re-runs `serve` with the mode it found recorded.
  test('--dev serves the source entry', () => {
    expect(resolveServeMode({ dev: true })).toBe('dev');
  });

  // `--prod` is accepted for compatibility and no longer selects anything.
  test('--prod is a no-op, and --dev wins when both are given', () => {
    expect(resolveServeMode({ prod: true })).toBe('prod');
    expect(resolveServeMode({ prod: true, dev: true })).toBe('dev');
  });
});
