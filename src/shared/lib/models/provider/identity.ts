/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Provider identity rules that are not a label, an endpoint or a dialect.
 *
 * Antigravity reaches Kabmo under more than one slug: omp names the OAuth
 * provider `google-antigravity`, while the Antigravity CLI plugin installs as
 * `antigravity-cli`. Both are the same product, and the quota panel has to
 * recognise either one — the client so it draws one section per model family
 * instead of a flat grid, the server so a local sign-in lands on the row that
 * already exists rather than creating a second one beside it.
 *
 * Spelling-based on purpose: the slug is the identity and no endpoint is
 * stored for an OAuth provider, so a base-URL rule (the one `token-harbor.ts`
 * uses) has nothing to read.
 */

/** Whether a provider slug names Antigravity, whatever suffix it carries. */
export function isAntigravityProviderSlug(slug: string): boolean {
  return slug
    .trim()
    .toLowerCase()
    .replace(/[-_\s]/g, '')
    .includes('antigravity');
}
