/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { test, expect, describe } from 'bun:test';
import { resolveInsideRoot } from '@/shared/lib/panels/resolve-asset';

const ROOT = '/plugins/demo';

describe('resolveInsideRoot', () => {
  test('resolves a plain relative path inside the root', () => {
    expect(resolveInsideRoot(ROOT, 'index.html')).toBe('/plugins/demo/index.html');
  });

  test('resolves a nested path', () => {
    expect(resolveInsideRoot(ROOT, 'assets/logo.svg')).toBe('/plugins/demo/assets/logo.svg');
  });

  test('allows the root itself', () => {
    expect(resolveInsideRoot(ROOT, '.')).toBe(ROOT);
  });

  test('refuses a single-level escape', () => {
    expect(resolveInsideRoot(ROOT, '../secret.html')).toBeNull();
  });

  test('refuses an escape hidden behind a legitimate prefix', () => {
    expect(resolveInsideRoot(ROOT, 'assets/../../secret.html')).toBeNull();
  });

  test('refuses an absolute path outside the root', () => {
    expect(resolveInsideRoot(ROOT, '/etc/passwd')).toBeNull();
  });

  test('refuses a sibling whose name starts with the root name', () => {
    // `/plugins/demo-evil` must not pass a naive `startsWith(root)` test.
    expect(resolveInsideRoot(ROOT, '../demo-evil/x.html')).toBeNull();
  });

  test('allows a filename that merely contains two dots', () => {
    expect(resolveInsideRoot(ROOT, 'a..b.html')).toBe('/plugins/demo/a..b.html');
  });

  test('refuses a deep escape', () => {
    expect(resolveInsideRoot(ROOT, '../../../../etc/passwd')).toBeNull();
  });

  test('a root with a trailing separator still contains its children', () => {
    // The ROOT has to be resolved too, not just the target. Comparing a
    // resolved target against a raw root works on POSIX only by accident — a
    // plain `/plugins/demo` survives `resolve` unchanged — and fails for every
    // root that is spelled any other way. On Windows it failed for EVERY call
    // (`C:\plugins\demo\x` never starts with `C:\plugins\demo\`), so every
    // plugin manifest was refused with "escapes the plugin directory" and no
    // plugin could load at all. This case fails with the old comparison on both
    // platforms.
    expect(resolveInsideRoot('/plugins/demo/', 'index.html')).toBe('/plugins/demo/index.html');
    expect(resolveInsideRoot('/plugins//demo', 'index.html')).toBe('/plugins/demo/index.html');
    expect(resolveInsideRoot('/plugins/demo/', '.')).toBe('/plugins/demo');
  });

  test('an escape is still refused when the root needs normalising', () => {
    // The fix must not widen the guard: a normalised root is still a boundary.
    expect(resolveInsideRoot('/plugins/demo/', '../secret.html')).toBeNull();
    expect(resolveInsideRoot('/plugins//demo', '../demo-evil/x.html')).toBeNull();
  });
});
