/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The directories a DROP made readable, and the bounds on that.
 *
 * This is the one place the fs allow-list can grow at run time, so every rule
 * here is a security property rather than a convenience: a grant names a
 * directory, it never covers the filesystem root, and the set cannot grow
 * without bound.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import path from 'path';
import {
  MAX_EXTERNAL_ROOTS,
  clearExternalRoots,
  externalRoots,
  grantExternalRoot,
  isExternalRoot,
} from '@/server/lib/fs/external-roots';

afterEach(() => clearExternalRoots());

/** The slot's shape, narrowed rather than asserted — the test reads a global. */
function isRootSlot(value: unknown): value is { roots: string[] } {
  if (typeof value !== 'object' || value === null || !('roots' in value)) return false;
  return Array.isArray(value.roots);
}

describe('external root grants', () => {
  test('a granted directory is readable, and nothing else is', () => {
    grantExternalRoot('/Users/someone/Desktop');
    expect(isExternalRoot('/Users/someone/Desktop')).toBe(true);
    // The parent is a different directory: dropping `~/Desktop/x.pdf` must not
    // make the whole home directory readable.
    expect(isExternalRoot('/Users/someone')).toBe(false);
    expect(isExternalRoot('/tmp')).toBe(false);
  });

  test('the spelling does not matter, but the directory does', () => {
    grantExternalRoot('/Users/someone/Desktop/');
    expect(isExternalRoot('/Users/someone/Desktop')).toBe(true);
    expect(isExternalRoot('/Users/someone/Desktop/../Desktop')).toBe(true);
    expect(isExternalRoot('/Users/someone/Desktopp')).toBe(false);
  });

  test('the filesystem root is refused', () => {
    // `/` would make every path on the machine readable, which is not what any
    // drop expressed.
    expect(grantExternalRoot('/')).toBeNull();
    expect(externalRoots()).toEqual([]);
  });

  test('a relative path is refused', () => {
    expect(grantExternalRoot('Desktop')).toBeNull();
    expect(externalRoots()).toEqual([]);
  });

  test('the set is bounded, and the oldest grant goes first', () => {
    for (let index = 0; index < MAX_EXTERNAL_ROOTS + 2; index += 1) {
      grantExternalRoot(`/tmp/kabmo-grant-${index}`);
    }
    expect(externalRoots().length).toBe(MAX_EXTERNAL_ROOTS);
    // The two oldest are gone; the newest are here.
    expect(isExternalRoot('/tmp/kabmo-grant-0')).toBe(false);
    expect(isExternalRoot('/tmp/kabmo-grant-1')).toBe(false);
    expect(isExternalRoot(`/tmp/kabmo-grant-${MAX_EXTERNAL_ROOTS + 1}`)).toBe(true);
  });

  test('re-granting moves a root to the newest position', () => {
    grantExternalRoot('/tmp/kabmo-first');
    for (let index = 0; index < MAX_EXTERNAL_ROOTS - 1; index += 1) {
      grantExternalRoot(`/tmp/kabmo-other-${index}`);
    }
    // One more would evict the oldest — unless it was just used again.
    grantExternalRoot('/tmp/kabmo-first');
    grantExternalRoot('/tmp/kabmo-last');
    expect(isExternalRoot('/tmp/kabmo-first')).toBe(true);
  });

  test('the grant list lives on globalThis, so a hot reload cannot drop it', () => {
    grantExternalRoot('/tmp/kabmo-hot-reload');
    // The property, not the module binding: `bun --hot` re-evaluates a changed
    // module in place, and a module-level array would be reset while the tab
    // whose file it describes stays open.
    const host: object = globalThis;
    expect('__kabmoExternalRoots' in host).toBe(true);
    const slot: unknown = Reflect.get(host, '__kabmoExternalRoots');
    expect(isRootSlot(slot) && slot.roots.includes(path.resolve('/tmp/kabmo-hot-reload'))).toBe(true);
  });

  test('the resolved path is what a grant stores', () => {
    const granted = grantExternalRoot('/tmp/kabmo-resolved/../kabmo-resolved');
    expect(granted).toBe(path.resolve('/tmp/kabmo-resolved'));
    expect(externalRoots()).toEqual([path.resolve('/tmp/kabmo-resolved')]);
  });
});
