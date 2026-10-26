/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The external-change probe.
 *
 * Three rules, and each is a silent failure if broken:
 *
 * - a REFUSED probe is not a verdict — offering a Reload over a dropped request is
 *   worse than saying nothing;
 * - a file that is GONE is the tab strip's strike-through, not a change strip;
 * - a MATCHING mtime is no change at all, which is what keeps the strip off a file
 *   nobody touched.
 */

import { afterEach, describe, expect, test } from 'bun:test';

import { probeExternalChange } from '@/client/hooks/editor/use-external-change';

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

describe('probeExternalChange', () => {
  test('a matching mtime is no change', async () => {
    stub({ exists: true, mtimeMs: 100 });
    expect(await probeExternalChange('/a.ts', null, null, 100)).toEqual({ kind: 'unchanged' });
  });

  test('a moved mtime is a change, carrying both sides', async () => {
    stub({ exists: true, mtimeMs: 200 });
    expect(await probeExternalChange('/a.ts', null, null, 100)).toEqual({
      kind: 'changed',
      mtimeMs: 200,
      baseMtimeMs: 100,
    });
  });

  test('a missing file is not a change — the tab strip owns that fact', async () => {
    stub({ exists: false, mtimeMs: null });
    expect(await probeExternalChange('/a.ts', null, null, 100)).toEqual({ kind: 'gone' });
  });

  test('a refused probe is NO VERDICT, never a change', async () => {
    stub({}, false);
    expect(await probeExternalChange('/a.ts', null, null, 100)).toEqual({ kind: 'unknown' });
  });

  test('a malformed body is no verdict', async () => {
    stub({ exists: 'yes' });
    expect(await probeExternalChange('/a.ts', null, null, 100)).toEqual({ kind: 'unknown' });
    stub(null);
    expect(await probeExternalChange('/a.ts', null, null, 100)).toEqual({ kind: 'unknown' });
  });

  test('a dropped connection is no verdict', async () => {
    globalThis.fetch = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await probeExternalChange('/a.ts', null, null, 100)).toEqual({ kind: 'unknown' });
  });

  test('a file that exists with no mtime to report is no verdict', async () => {
    stub({ exists: true });
    expect(await probeExternalChange('/a.ts', null, null, 100)).toEqual({ kind: 'unknown' });
  });

  test('the scope travels with the probe, so a nested repo is read from its own tree', async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (input: unknown) => {
      seen.push(String(input));
      return { ok: true, json: async () => ({ exists: true, mtimeMs: 100 }) };
    }) as unknown as typeof fetch;
    await probeExternalChange('a.ts', '/repo', 'nested', 100);
    expect(seen[0]).toContain('root=%2Frepo');
    expect(seen[0]).toContain('repo=nested');
  });
});
