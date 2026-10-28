/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Catalog model identity.
 *
 * A model id is NOT unique on its own: the omp registry exposes the same id
 * through several providers (`deepseek-v4-flash` exists under both `deepseek`
 * and `kenari`, `deepseek-v4-pro` likewise, …). Keying a lookup, a selection or
 * a mutation on the id alone resolves to whichever provider comes first —
 * hovering one row highlights the other provider's row, and toggling a
 * favourite or a thinking preset mutates the wrong model.
 *
 * `modelKey` is the single composite identity every lookup/map/React key must
 * agree on, so the pieces cannot drift apart.
 */
export function modelKey(model: { provider: string; id: string } | null | undefined): string {
  return model ? `${model.provider}:${model.id}` : '';
}
