/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Compressed bytes for a static asset, kept across requests.
 *
 * `plugins/compress.ts` compresses per response, which is right for a 4 KB JSON
 * body and wrong for the client bundle: the production bundle is 10.4 MB, and
 * re-compressing it on every cold request costs ~20 ms of blocked event loop
 * for a result that cannot have changed. Measured on this repo's own bundle:
 * zstd 10.4 MB -> 2.15 MB in 20 ms, gzip -> 2.32 MB in 66 ms.
 *
 * The key is the asset's own ETag plus the encoding, so an entry is valid
 * exactly as long as the bytes it was made from — a rebuild changes the ETag
 * (size and mtime both move) and the old entry simply stops being asked for.
 * That also means no invalidation logic: the map is bounded, and a stale entry
 * is evicted by age, never served.
 *
 * Two bounds, because a bundle-sized entry is not a small one: an entry count
 * and a total byte budget. A single entry larger than the budget is still
 * RETURNED — it just is not retained — since the caller needs the bytes it
 * asked for either way.
 */

/** Encodings' worth of the biggest asset, plus room for the next build. */
const MAX_ENTRIES = 8;
const MAX_TOTAL_BYTES = 48 * 1024 * 1024;

const entries = new Map<string, Uint8Array<ArrayBuffer>>();
const inFlight = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();
let totalBytes = 0;

/**
 * The compressed bytes for `key`, computing them once.
 *
 * Concurrent requests for the same key share one computation: two tabs opening
 * a cold instance at the same moment would otherwise both compress 10 MB.
 */
export async function compressedAsset(
  key: string,
  produce: () => Promise<Uint8Array<ArrayBuffer>>,
): Promise<Uint8Array<ArrayBuffer>> {
  const hit = entries.get(key);
  if (hit) {
    // Re-insert so the map's own order stays least-recently-used first.
    entries.delete(key);
    entries.set(key, hit);
    return hit;
  }

  const pending = inFlight.get(key);
  if (pending) return pending;

  const work = produce().then((bytes) => {
    retain(key, bytes);
    return bytes;
  }).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, work);
  return work;
}

function retain(key: string, bytes: Uint8Array<ArrayBuffer>): void {
  // Too big to keep. The caller already holds the reference, so the response is
  // built from it; retaining it would evict everything else and then itself.
  if (bytes.byteLength > MAX_TOTAL_BYTES) return;
  entries.set(key, bytes);
  totalBytes += bytes.byteLength;
  // Evict oldest first, and never the entry just stored.
  for (const [candidate, value] of entries) {
    if (entries.size <= MAX_ENTRIES && totalBytes <= MAX_TOTAL_BYTES) break;
    if (candidate === key) continue;
    entries.delete(candidate);
    totalBytes -= value.byteLength;
  }
}

/** The retained byte count and entry count — the observable half of the cache. */
export function compressedCacheStats(): { entries: number; bytes: number } {
  return { entries: entries.size, bytes: totalBytes };
}

/** Drop everything. Tests only; nothing at runtime has a reason to call this. */
export function clearCompressedCache(): void {
  entries.clear();
  inFlight.clear();
  totalBytes = 0;
}
