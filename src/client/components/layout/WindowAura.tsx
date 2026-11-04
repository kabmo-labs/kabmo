/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The glow the glass plane blurs.
 *
 * Three empty, palette-tinted blobs under the window's frosted plane
 * (`glass.css` draws them from `--aura`, which each child maps to a theme token).
 * They exist because a `backdrop-filter` can only sample what is painted behind
 * it: over a flat canvas the frost is indistinguishable from a plain translucent
 * panel, and the whole material reads as "slightly washed out" instead of glass.
 *
 * It renders in every document and is inert in the classic look — no rule
 * targets it without `[data-surface="glass"]` — because a conditional mount here
 * would be a second place that knows about the surface style.
 */
export function WindowAura() {
  return (
    <div className="app-window-aura" aria-hidden="true">
      <i />
      <i />
      <i />
    </div>
  );
}
