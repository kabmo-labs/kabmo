/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The provider id a name becomes, and the shape every registry accepts.
 *
 * Each agent keys its provider table differently — omp's YAML map, opencode's
 * JSON object, codex's `[model_providers.<id>]`, kimi's `[providers.<id>]` with
 * dots and colons in its own managed names — so the id Kabmo writes is the
 * INTERSECTION every format accepts. Deriving it in the browser alone would let
 * a form store an id the server then refuses; the same function runs on both
 * sides, and this module is the one definition.
 *
 * Pure and dependency-free: the form previews with it, the route validates with
 * it, and the two cannot disagree about what "My Gateway" becomes.
 */

/** The shape every registry in `provider-facts.ts` accepts as a key. */
export const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,63}$/;

/**
 * `My Gateway (EU)` → `my-gateway-eu`; `kenari.id` → `kenari-id`.
 *
 * Dashes for every run of other characters, and no leading/trailing dash — the
 * same rule the Add Provider dialog uses for omp's own models.yml, so a provider
 * named once reads the same in every agent it is added to.
 */
export function providerSlugFrom(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/** Why an id cannot be written, or null when it can. */
export function providerIdProblem(id: string): string | null {
  if (!id.trim()) return 'Enter a provider name to derive an id.';
  if (!PROVIDER_ID_PATTERN.test(id)) {
    return 'The id must start with a letter or digit, and hold only a-z, 0-9, dot, underscore, colon or dash.';
  }
  return null;
}
