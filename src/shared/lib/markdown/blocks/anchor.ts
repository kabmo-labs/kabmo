/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The identity of a block: its type, a digest of its text, and an ordinal.
 *
 * ## Why not a line number
 *
 * A line is where a block HAPPENS to be. Inserting one paragraph above it moves
 * every block below, and a note keyed by line would then describe the wrong
 * text — the failure that makes reviews untrustworthy.
 *
 * ## Why not a cryptographic digest
 *
 * This module is imported by `src/shared/**`, which also runs in the browser,
 * so `Bun.CryptoHasher` is unavailable and `crypto.subtle` is async (a render
 * path cannot await). FNV-1a over UTF-16 code units is synchronous, allocation
 * free, and more than strong enough: the ordinal below settles the only
 * collisions that matter.
 *
 * ## What the ordinal settles
 *
 * Two identical blocks (a repeated `## Notes`, two identical list items) hash
 * the same, so the Nth occurrence is part of the key. Reordering them swaps
 * their identities, which is correct — they are indistinguishable.
 */

/** Whitespace is not content: a reflow is not an edit. */
export function normalizeBlockText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** FNV-1a, 32-bit, hex. Deterministic and dependency-free. */
export function hashBlockText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * The key for one block, given the blocks already emitted for the document.
 *
 * `seen` is mutated (the occurrence count moves), because the caller walks the
 * document once and each duplicate needs the next ordinal.
 */
export function blockKeyOf(type: string, raw: string, seen: Map<string, number>): string {
  const base = `${type}:${hashBlockText(normalizeBlockText(raw))}`;
  const occurrence = (seen.get(base) ?? 0) + 1;
  seen.set(base, occurrence);
  return `${base}#${occurrence}`;
}

/** The block text a reviewer (and the prompt) sees: one line, bounded. */
export function quoteOf(raw: string, limit = 160): string {
  const collapsed = normalizeBlockText(raw);
  if (collapsed.length <= limit) return collapsed;
  return `${collapsed.slice(0, Math.max(0, limit - 1))}…`;
}
