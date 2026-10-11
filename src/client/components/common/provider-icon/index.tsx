/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The brand mark for a provider, or its initials when no mark is registered.
 *
 * Every provider surface draws through this one component — the settings
 * sidebar, the provider header, the login/reconnect modals, the "add provider"
 * preset list, the composer's model picker and the usage panel — so a provider
 * cannot be a whale emoji in one place and a generic cloud in another.
 *
 * Resolution order is the `providerIcon` slot's contract: a plugin's registered
 * mark for a provider wins over the built-in table, and only for the provider it
 * names ({@link resolveProviderMark}). Because there is one component, there is
 * one place that order lives.
 *
 * The mark is painted in `currentColor`, so it takes the surrounding ink and
 * follows the theme. That is deliberate: the app's palette is a monochrome
 * paper/ink system (`DESIGN.md`), and a full-colour logo per row would be the
 * only chroma in a dense list. Brand identity is carried by the shape.
 *
 * Fallback rule: a provider with no registered mark shows its initials, each
 * followed by a dot — `Tooker` -> `t.`, `Toktok ID` -> `ti.`
 * ({@link providerInitials}). A provider that is not in the table still gets a
 * stable, readable badge rather than an empty box.
 */

import type { ProviderIconRegistration } from '@ompchamber/plugin-sdk';
import { resolveProviderMark } from '@/client/components/common/provider-icon/resolve';
import { useListSlotRows } from '@/client/hooks/workspace/list-slots';
import { providerInitials } from '@/shared/lib/models/provider/glyph';

interface ProviderIconProps {
  /**
   * The provider row's stored icon key (`ProviderItem.icon`). Tried first, so a
   * legacy key keeps resolving after the provider's slug changes.
   */
  icon?: string;
  /** The provider slug — the primary brand key. */
  slug?: string;
  /** Display name; only the initials fallback reads it. */
  name?: string;
  size?: number;
  className?: string;
}

export function ProviderIcon({ icon, slug, name, size = 16, className = '' }: ProviderIconProps) {
  // The ONE resolution point: a plugin's `providerIcon` registration for this
  // provider wins over the built-in table, and any other provider is untouched.
  // Read reactively, so a bundle that registers after this icon mounted still
  // reaches it — the same contract every other list slot has.
  const registered = useListSlotRows<ProviderIconRegistration>('providerIcon');
  const glyph = resolveProviderMark([icon, slug, name], registered);

  if (!glyph) {
    // No mark: the initials badge. It is a PILL, not a square — the text has to
    // sit at the same visual weight as a brand mark, and `ti.` is far wider than
    // it is tall, so a square column would force a font size half the height of
    // its neighbours' ink (measured: `ti.` fits a 15px column only at 9.5px,
    // whose glyph ink is 6.4px against the marks' 13.8px median). Height stays
    // `size`, width follows the text.
    //
    // 1.2x is the largest size whose ink still lands inside the box (measured on
    // canvas: ink 10-15px in a 16px band with >=1px clearance, versus clipping
    // at 1.3x), and it brings the text level with the marks' ink.
    // `aria-hidden` because the provider's name is always rendered beside it —
    // a screen reader announcing "t." first is noise.
    return (
      <span
        aria-hidden="true"
        className={`inline-flex flex-shrink-0 items-center justify-center font-semibold lowercase leading-none ${className}`}
        style={{ height: size, minWidth: size, paddingInline: Math.max(1, Math.round(size * 0.12)), fontSize: Math.round(size * 1.2) }}
      >
        {providerInitials(name || slug || icon || '')}
      </span>
    );
  }

  return (
    <svg
      viewBox={glyph.viewBox}
      width={size}
      height={size}
      // The caller owns the ink, and it MUST be declared here. Most source
      // marks (`anthropic`, `openai`, `deepseek`, …) are drawn with no paint
      // attribute at all and rely on the SVG default, which is BLACK — so the
      // mark stayed black on every theme and vanished against a dark canvas.
      // `fill` is an inherited property, so declaring it on the root paints
      // every descendant that does not set its own paint; the marks that DO
      // carry their own attributes (`azure`'s `fill-opacity`, `synthetic`'s
      // stroked outline, the baked `currentColor` paths) keep them.
      fill="currentColor"
      className={`flex-shrink-0 ${className}`}
      aria-hidden="true"
      focusable="false"
      // A built-in body is bake-time data from this repo; a registered one is
      // the plugin's own SVG source, reduced to its inner markup. Both are
      // trusted the same way: a plugin's bundle already runs in this document.
      dangerouslySetInnerHTML={{ __html: glyph.body }}
    />
  );
}
