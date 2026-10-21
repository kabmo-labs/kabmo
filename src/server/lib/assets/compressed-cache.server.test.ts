/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, test } from 'bun:test';

import { clearCompressedCache, compressedAsset, compressedCacheStats } from '@/server/lib/assets/compressed-cache.server';

describe('compressedAsset', () => {
  test('computes once for a key and serves the same bytes afterwards', async () => {
    clearCompressedCache();
    let produced = 0;
    const produce = async () => {
      produced += 1;
      return new Uint8Array([1, 2, 3]);
    };

    const first = await compressedAsset('k', produce);
    const second = await compressedAsset('k', produce);

    expect(produced).toBe(1);
    expect(second).toEqual(first);
  });

  // Two tabs opening a cold instance at the same moment would otherwise both
  // compress a 10 MB bundle. The gate is a deferred promise, not a delay: the
  // second caller must join the first while it is still unresolved.
  test('shares one computation between concurrent callers', async () => {
    clearCompressedCache();
    const gate = Promise.withResolvers<void>();
    let produced = 0;
    const produce = async () => {
      produced += 1;
      await gate.promise;
      return new Uint8Array([9]);
    };

    const first = compressedAsset('shared', produce);
    const second = compressedAsset('shared', produce);
    gate.resolve();
    const [a, b] = await Promise.all([first, second]);

    expect(produced).toBe(1);
    expect(a).toEqual(b);
  });

  test('a different key is a different entry', async () => {
    clearCompressedCache();
    await compressedAsset('one', async () => new Uint8Array([1]));
    await compressedAsset('two', async () => new Uint8Array([2]));

    expect(compressedCacheStats().entries).toBe(2);
  });

  // An entry is keyed by the asset's ETag, so a rebuild is a new key and the
  // old bytes are never asked for again. Retention is bounded by count.
  test('retains a bounded number of entries', async () => {
    clearCompressedCache();
    for (let i = 0; i < 20; i += 1) {
      await compressedAsset(`key-${i}`, async () => new Uint8Array(1024));
    }

    const stats = compressedCacheStats();
    expect(stats.entries).toBeLessThanOrEqual(8);
    expect(stats.bytes).toBeLessThanOrEqual(48 * 1024 * 1024);
  });

  // The caller needs the bytes it asked for even when they cannot be kept, or a
  // single asset larger than the budget would fail to serve at all.
  test('returns an asset larger than the whole budget', async () => {
    clearCompressedCache();
    const huge = new Uint8Array(50 * 1024 * 1024);
    const bytes = await compressedAsset('huge', async () => huge);

    expect(bytes.byteLength).toBe(huge.byteLength);
  });
});
