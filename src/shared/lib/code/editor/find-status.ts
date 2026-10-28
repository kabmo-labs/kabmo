/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The find widget's readouts, as rules rather than JSX conditionals.
 *
 * Two of these are the widget's whole reason for being honest: "No results" and
 * "your pattern does not compile" are different answers, and a match list that
 * stopped at the cap has to say so rather than report a total it never counted.
 */

/** Ceiling on collected matches; past it the count is reported with a `+`. */
export interface FindCounts {
  total: number;
  current: number;
  truncated: boolean;
}

/** `3 of 7`, `1 of 5000+`, or an empty string when there is nothing to say. */
export function findCounterLabel({ total, current, truncated }: FindCounts): string {
  if (total === 0) return '';
  return `${current + 1} of ${total}${truncated ? '+' : ''}`;
}

/**
 * The status line: an uncompilable pattern is named as such, a query with no
 * matches says so, and an empty query says nothing at all (a "0 results" over
 * an untouched field is noise).
 */
export function findStatusLabel(query: string, invalid: boolean, counts: FindCounts): string {
  if (invalid) return 'Invalid pattern';
  if (counts.total === 0) return query ? 'No results' : '';
  return findCounterLabel(counts);
}
