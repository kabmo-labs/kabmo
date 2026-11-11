/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The disk-digest probe the editor's auto-refresh runs.
 *
 * Three rules, and each is a silent failure if broken:
 *
 * - a REFUSED probe is not a verdict — a dropped request must never be read as
 *   "the disk changed" and replace a buffer;
 * - a file that is GONE is the tab strip's strike-through, not a change;
 * - a file with no hash (too large for the editor, unreadable) has nothing to
 *   compare, so it is no verdict either.
 */

import { afterEach, describe, expect, test } from 'bun:test';

import { probeDiskDigest } from '@/client/hooks/editor/use-disk-digest';

const nativeFetch = Bun.fetch;

afterEach(() => {
  globalThis.fetch = nativeFetch;
});

/** Answer the probe with `body`, or refuse it. */
function stub(body: unknown, ok = true): void {
  globalThis.fetch = (async () => ({
    ok,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe('probeDiskDigest', () => {
  test('a file with a hash is a verdict carrying both facts', async () => {
    stub({ exists: true, mtimeMs: 100, hash: 'abc' });
    expect(await probeDiskDigest('/a.ts', null, null)).toEqual({ hash: 'abc', mtimeMs: 100 });
  });

  test('a missing file is not a change — the tab strip owns that fact', async () => {
    stub({ exists: false, mtimeMs: null, hash: null });
    expect(await probeDiskDigest('/a.ts', null, null)).toBe('gone');
  });

  test('a file with no hash is no verdict', async () => {
    stub({ exists: true, mtimeMs: 100, hash: null });
    expect(await probeDiskDigest('/a.ts', null, null)).toBe('unknown');
  });

  test('a refused probe is NO VERDICT, never a change', async () => {
    stub({ exists: true, mtimeMs: 100, hash: 'abc' }, false);
    expect(await probeDiskDigest('/a.ts', null, null)).toBe('unknown');
  });

  test('a malformed body is no verdict', async () => {
    stub({ exists: 'yes' });
    expect(await probeDiskDigest('/a.ts', null, null)).toBe('unknown');
    stub(null);
    expect(await probeDiskDigest('/a.ts', null, null)).toBe('unknown');
  });

  test('a dropped connection is no verdict', async () => {
    globalThis.fetch = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await probeDiskDigest('/a.ts', null, null)).toBe('unknown');
  });

  test('the scope travels with the probe, so a nested repo is read from its own tree', async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (input: unknown) => {
      seen.push(String(input));
      return { ok: true, json: async () => ({ exists: true, mtimeMs: 100, hash: 'abc' }) };
    }) as unknown as typeof fetch;
    await probeDiskDigest('a.ts', '/repo', 'nested');
    expect(seen[0]).toContain('/api/fs/digest');
    expect(seen[0]).toContain('root=%2Frepo');
    expect(seen[0]).toContain('repo=nested');
  });
});
