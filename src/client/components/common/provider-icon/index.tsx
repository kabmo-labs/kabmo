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

import type { ProviderIconRegistration } from '@kabmo-labs/kabmo-sdk';
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
  /**
   * Draw inside a box of exactly `size` and never exceed it.
   *
   * The initials fallback is a PILL whose width follows its text, which is right
   * when it stands alone beside a name (the composer picker) and wrong inside a
   * fixed plate: measured in the settings list, `ab.` at the unbounded 1.2x font
   * came out ~25px wide in a 20px content box and spilled over the plate's
   * rounded edge. Bounded, the badge becomes a square that centres the text and
   * sizes the font to fit the initials it actually has.
   */
  bounded?: boolean;
}

export function ProviderIcon({
  icon,
  slug,
  name,
  size = 16,
  className = '',
  bounded = false,
}: ProviderIconProps) {
  // The ONE resolution point: a plugin's `providerIcon` registration for this
  // provider wins over the built-in table, and any other provider is untouched.
  // Read reactively, so a bundle that registers after this icon mounted still
  // reaches it — the same contract every other list slot has.
  const registered = useListSlotRows<ProviderIconRegistration>('providerIcon');
  const glyph = resolveProviderMark([icon, slug, name], registered);

  if (!glyph) {
    // No mark: the initials badge.
    //
    // Standalone (the default) it is a PILL, not a square — the text sits at the
    // same visual weight as a brand mark beside it, and `ti.` is far wider than
    // it is tall, so a square would force a font half the height of its
    // neighbours' ink (measured: `ti.` fits a 15px column only at 9.5px, whose
    // ink is 6.4px against the marks' 13.8px median). Width follows the text.
    //
    // `bounded` is the plate case, where the box is fixed and nothing may leave
    // it: the badge becomes a square of exactly `size`, the text is centred, and
    // the font is chosen from the initials' own length — three characters
    // (`ab.`, `ti.`) are the widest the contract can produce
    // ({@link providerInitials} caps at two words), so that is what the size is
    // derived from.
    //
    // `aria-hidden` because the provider's name is always rendered beside it —
    // a screen reader announcing "t." first is noise.
    const initials = providerInitials(name || slug || icon || '');
    if (bounded) {
      return (
        <span
          aria-hidden="true"
          className={`inline-flex flex-shrink-0 items-center justify-center overflow-hidden font-semibold lowercase leading-none ${className}`}
          style={{
            width: size,
            height: size,
            fontSize: Math.round(size * (initials.length >= 3 ? 0.64 : 0.82)),
            letterSpacing: '-0.02em',
          }}
        >
          {initials}
        </span>
      );
    }
    return (
      <span
        aria-hidden="true"
        className={`inline-flex flex-shrink-0 items-center justify-center font-semibold lowercase leading-none ${className}`}
        style={{ height: size, minWidth: size, paddingInline: Math.max(1, Math.round(size * 0.12)), fontSize: Math.round(size * 1.2) }}
      >
        {initials}
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
      // `block` + the explicit width/height are the containment contract: an
      // inline SVG sits on the text baseline and adds descender space, which is
      // how a mark "fits" its attributes yet still pushes a plate's edge.
      style={{ display: 'block' }}
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
