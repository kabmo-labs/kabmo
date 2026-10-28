/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Replacement expansion, split from the scan.
 *
 * The scan (`find-scan.ts`) answers "where does this query match"; this answers
 * "what does one match become". They are separate because the search panel's
 * replace PREVIEW and the write that actually lands must read ONE expansion
 * rule — a row that painted `$1` literally over a file that would receive the
 * captured group is the drift this module exists to prevent — while the scan has
 * a different consumer (the find bar's match list and count).
 *
 * The template grammar is `String.prototype.replace`'s for a string replacement:
 * `$$`, `$&`, `$1`–`$99` and `$<name>`. The prefix/suffix forms (`` $` `` /
 * `$'`) are deliberately left literal — nothing in the UI offers them, and
 * leaving the two characters alone is the honest reading.
 */

import { buildFindRegex, type FindMatch, type FindOptions } from '@/shared/lib/code/editor/find-scan';

/** What a replacement template is expanded against. */
export interface MatchGroups {
  /** `$&` — the whole match. */
  full: string;
  /** `$1`…`$99`, indexed by their own number: entry `n` is group `n` (`[0]` is unused). */
  numbered: readonly (string | undefined)[];
  /** `$<name>` — named capture groups. */
  named?: Record<string, string | undefined>;
}

/** The engine's own argument order: `found[1]` is `$1`. */
function groupsOf(found: RegExpExecArray): MatchGroups {
  return {
    full: found[0],
    numbered: [undefined, ...found.slice(1)],
    named: found.groups,
  };
}

const SUBSTITUTION = /\$(\$|&|\d{1,2}|<[^>]*>)/g;

/**
 * Expand a replacement template the way `String.prototype.replace` does for a
 * string replacement: `$$`, `$&`, `$1`–`$99` and `$<name>`. The prefix/suffix
 * forms (`` $` `` / `$'`) are deliberately left literal — nothing in the UI
 * offers them, and leaving the two characters alone is the honest reading.
 *
 * A two-digit group that does not exist falls back to the one-digit group plus
 * the second digit, which is the engine's own behaviour for `$12` when the
 * pattern has one group.
 */
export function expandReplacement(template: string, groups: MatchGroups): string {
  if (!template.includes('$')) return template;
  return template.replace(SUBSTITUTION, (_token, body: string) => {
    if (body === '$') return '$';
    if (body === '&') return groups.full;
    if (body.startsWith('<')) return groups.named?.[body.slice(1, -1)] ?? '';
    if (body.length === 2) {
      const direct = groups.numbered[Number(body)];
      if (direct !== undefined) return direct;
      const first = groups.numbered[Number(body[0])];
      return first === undefined ? '' : first + body[1];
    }
    return groups.numbered[Number(body)] ?? '';
  });
}

/**
 * The text one match is replaced by, expanded exactly as the write path
 * expands it. Null when the match no longer resolves in `text` — the pattern is
 * re-run at the match's own offset rather than trusting the offsets handed in,
 * so a stale list cannot splice the wrong range.
 *
 * Extracted so the search panel's replace PREVIEW and the replacement that
 * actually lands read one expansion rule: a row that painted `$1` literally
 * over a file that would receive the captured group is the drift this prevents.
 */
export function replacementForMatch(
  text: string,
  match: FindMatch,
  query: string,
  replacement: string,
  options: FindOptions,
): { found: string; inserted: string; start: number; end: number } | null {
  const regex = buildFindRegex(query, options);
  if (!regex) return null;
  regex.lastIndex = match.start;
  const found = regex.exec(text);
  if (!found || found.index !== match.start) return null;
  // Literal mode inserts the field verbatim: `$&` in the replace box is the
  // two characters the user typed, not the match. Regex mode expands the
  // template against the match's own groups.
  const inserted = options.isRegex ? expandReplacement(replacement, groupsOf(found)) : replacement;
  return { found: found[0], inserted, start: found.index, end: found.index + found[0].length };
}

/**
 * Replace one match. Returns the new buffer and where the caret should land
 * (just after the inserted text), or null when the match is no longer there.
 */
export function replaceMatch(
  text: string,
  match: FindMatch,
  query: string,
  replacement: string,
  options: FindOptions,
): { text: string; caret: number } | null {
  const resolved = replacementForMatch(text, match, query, replacement, options);
  if (!resolved) return null;
  return {
    text: text.slice(0, resolved.start) + resolved.inserted + text.slice(resolved.end),
    caret: resolved.start + resolved.inserted.length,
  };
}

/**
 * Replace every match. Null when the query is empty or does not compile.
 *
 * A ZERO-WIDTH match is left alone, exactly as the scan leaves it out of the
 * list: `^`, `$`, `\b` and `a*` have nothing to highlight and nothing to
 * replace, so a `^` query reads "No results" in the widget — and rewriting every
 * line start under it was the write disagreeing with the count it was shown
 * next to. (A non-empty literal query can never match zero characters, so this
 * only ever applies to regex mode.)
 */
export function replaceAllMatches(
  text: string,
  query: string,
  replacement: string,
  options: FindOptions,
): string | null {
  const regex = buildFindRegex(query, options);
  if (!regex) return null;
  if (!options.isRegex) return text.replace(regex, () => replacement);
  return text.replace(regex, (...args: unknown[]) => {
    if (String(args[0]).length === 0) return '';
    // A replacer's arguments are `(match, …groups, offset, string, groups?)`;
    // rebuilding an exec result from them keeps one expansion rule for both
    // the single and the bulk path.
    const last = args[args.length - 1];
    const hasNamed = typeof last === 'object' && last !== null;
    const groups = args.slice(1, args.length - (hasNamed ? 3 : 2)) as string[];
    return expandReplacement(replacement, {
      full: String(args[0]),
      numbered: [undefined, ...groups],
      named: hasNamed ? (last as Record<string, string | undefined>) : undefined,
    });
  });
}
