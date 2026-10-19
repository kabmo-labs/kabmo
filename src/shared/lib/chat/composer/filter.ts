import type { ComposerMatchItem, ComposerPickItem, ComposerTrigger } from '@/shared/types';
import { filterCommandItems, commandArgumentItems } from '@/shared/lib/chat/composer/commands';

/** Detects the `file:` query prefix (case-insensitive) that scopes to files. */
const FILE_QUERY_PREFIX_RE = /^file:/i;

/** Rank tiers for `@` mentions (Kabmo-only; omp's file completion is path-based). */
interface RankedMatch {
  tier: number;
  index: number;
  match: { start: number; end: number } | null;
}

/**
 * Score a single item against a query. Tier order: exact name > name
 * startsWith > name includes > description includes. Returns null on no match.
 */
function rankComposerItem(
  name: string,
  description: string,
  query: string,
): { tier: number; match: { start: number; end: number } | null } | null {
  const q = query.trim().toLowerCase();
  if (q === '') return null;

  const lowerName = name.toLowerCase();
  const lowerDescription = description.toLowerCase();

  if (lowerName === q) return { tier: 0, match: { start: 0, end: name.length } };
  if (lowerName.startsWith(q)) return { tier: 1, match: { start: 0, end: q.length } };

  const nameIndex = lowerName.indexOf(q);
  if (nameIndex >= 0) return { tier: 2, match: { start: nameIndex, end: nameIndex + q.length } };

  if (lowerDescription.includes(q)) return { tier: 3, match: null };

  return null;
}

/**
 * Filter `@` mention items by query, ranked by tier then original order.
 *
 * `file:` scopes the pool to files and ranks on the path remainder, so
 * `@file:composer` finds `app/lib/chat/composer/client.ts`. Bare `@` keeps the
 * full agents + files pool.
 */
function filterMentionItems(items: ComposerPickItem[], query: string): ComposerMatchItem[] {
  const trimmed = query.trim();

  const fileQuery = FILE_QUERY_PREFIX_RE.test(trimmed);
  const pool = fileQuery ? items.filter((item) => item.source === 'file') : items;
  const rankingQuery = fileQuery ? trimmed.replace(FILE_QUERY_PREFIX_RE, '').trim() : trimmed;

  if (rankingQuery === '') {
    return pool.map((item) => ({ ...item, match: null }));
  }

  const ranked: RankedMatch[] = [];
  pool.forEach((item, index) => {
    const score = rankComposerItem(item.name, item.description, rankingQuery);
    if (score) ranked.push({ ...score, index });
  });

  ranked.sort((a, b) => a.tier - b.tier || a.index - b.index);

  return ranked.map((entry) => ({ ...pool[entry.index], match: entry.match }));
}

/** Dispatch on the trigger: mentions keep their own ranking, commands use omp's. */
export function filterComposerItems(items: ComposerPickItem[], trigger: ComposerTrigger): ComposerMatchItem[] {
  if (trigger.kind === 'mention') return filterMentionItems(items, trigger.query);
  if (trigger.phase === 'args' && trigger.command) {
    return commandArgumentItems(items, trigger.command, trigger.query);
  }
  return filterCommandItems(items, trigger.query, trigger.midPrompt === true);
}
