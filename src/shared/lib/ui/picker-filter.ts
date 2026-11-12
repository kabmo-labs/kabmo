/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The match rule every searchable picker uses.
 *
 * Case- and separator-insensitive, so "claude sonnet" finds `claude-sonnet-5`
 * and "build pipe" finds "Build pipeline". It lives in `shared/lib` because two
 * surfaces ask the same question — `SearchSelect` in settings and the composer's
 * target pickers — and a second copy of the fold rule drifts the moment one of
 * them is tuned.
 */
export function matchesPickerQuery(haystack: string, query: string): boolean {
  const needle = query.trim();
  if (!needle) return true;
  const fold = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return fold(haystack).includes(fold(needle));
}
