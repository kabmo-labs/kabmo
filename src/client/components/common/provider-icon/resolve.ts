/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `providerIcon` slot's half of the provider-mark resolution.
 *
 * `ProviderIcon` is the ONE component every provider surface draws through, so
 * this is the ONE place a plugin's mark can enter the app: registrations are
 * resolved here, ahead of the built-in table, and nowhere else. A per-surface
 * lookup would let one provider be a plugin's mark in Settings and a built-in
 * one in the model picker.
 *
 * Two properties are load-bearing:
 *
 * - A registration affects ONLY the provider it names. Matching folds the
 *   provider with the same rule the built-in table uses ({@link foldProviderKey}),
 *   so `google-vertex`, `Google Vertex` and a legacy icon key all find a
 *   registration, while an unmatched key falls through untouched.
 * - A glyph that does not parse falls through to the built-in mark. The plugin
 *   layer supplies raw SVG source, and a broken string must leave the provider
 *   with its built-in mark rather than an empty tile.
 */

import type { ProviderIconRegistration } from '@kabmo-labs/kabmo-sdk';
import type { ProviderGlyph } from '@/client/components/common/provider-icon/glyphs';
import { PROVIDER_GLYPHS } from '@/client/components/common/provider-icon/glyphs';
import type { ListSlotRows } from '@/client/lib/plugins/list-slots';
import { foldProviderKey, resolveProviderGlyph } from '@/shared/lib/models/provider/glyph';

/**
 * The root `<svg>` of a plugin's glyph source: its opening tag and the index of
 * the closing one. Null when the string is not one SVG element.
 */
function svgRoot(source: string): { attributes: string; bodyStart: number; bodyEnd: number } | null {
  const open = /<svg\b([^>]*)>/i.exec(source);
  if (!open) return null;
  const bodyEnd = source.lastIndexOf('</svg>');
  if (bodyEnd < 0) return null;
  return { attributes: open[1], bodyStart: open.index + open[0].length, bodyEnd };
}

/**
 * A plugin's `glyph` (a complete SVG source string) as the same
 * `{ viewBox, body }` shape the built-in table holds, or null when it is not a
 * usable SVG.
 *
 * Only the root's `viewBox` and its inner markup are taken: the host owns the
 * `<svg>` element so the mark inherits `currentColor` and the caller's size and
 * class exactly like a built-in one, and injecting a second svg root inside it
 * would not.
 */
export function parseRegisteredGlyph(source: string): ProviderGlyph | null {
  const root = svgRoot(source);
  if (!root) return null;
  const body = source.slice(root.bodyStart, root.bodyEnd).trim();
  if (!body) return null;
  const viewBox = /viewBox\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(root.attributes);
  const box = (viewBox?.[1] ?? viewBox?.[2] ?? '').trim();
  if (!box) return null;
  return { viewBox: box, body };
}

/**
 * The mark to draw for a provider: a plugin's registration when one matches,
 * otherwise the built-in table entry.
 *
 * Candidates are tried in the order the built-in resolver uses (`icon` before
 * `slug` before `name`), and registrations in the order the store merged them —
 * `order`, then plugin id, then registration id — so the FIRST registration for
 * a provider wins deterministically and the loser is still an accepted
 * registration, not a refused one. That first registration is authoritative: a
 * glyph that does not parse falls through to the built-in mark rather than
 * reaching for a later plugin's, so the mark shown never depends on which plugin
 * happened to ship a broken string.
 */
export function resolveProviderMark(
  candidates: ReadonlyArray<string | null | undefined>,
  registered: ListSlotRows<ProviderIconRegistration>,
): ProviderGlyph | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const key = foldProviderKey(candidate);
    if (!key) continue;
    const entry = registered.find((row) => foldProviderKey(row.registration.provider) === key);
    if (!entry) continue;
    const glyph = parseRegisteredGlyph(entry.registration.glyph);
    if (glyph) return glyph;
    break;
  }
  const name = resolveProviderGlyph(...candidates);
  return name ? (PROVIDER_GLYPHS[name] ?? null) : null;
}
