/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The palette's match rule for commands.
 *
 * Tiered like `scoreQuickOpen`, because the two pickers answer the same
 * question — "which row did the user mean" — and a second ranking philosophy
 * would make `⌘P` and `⌘⇧P` feel like different products. A title hit always
 * beats a keyword hit, and a shorter title wins ties.
 */

import type { CommandMeta } from '@/shared/lib/commands/types';

function tier(haystack: string, needle: string, weight: number): number | null {
  if (haystack === needle) return weight + 300;
  if (haystack.startsWith(needle)) return weight + 200;
  if (haystack.includes(needle)) return weight + 100;
  return null;
}

/** Whether `needle` appears in `haystack` in order, not necessarily adjacent. */
function isSubsequence(haystack: string, needle: string): boolean {
  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return needle.length === 0;
}

/** A score for one command against a query, or `null` when it does not match. */
export function scoreCommand(meta: CommandMeta, query: string): number | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;

  const title = meta.title.toLowerCase();
  const titleScore = tier(title, needle, 1000);
  if (titleScore !== null) return titleScore - meta.title.length / 100;

  for (const keyword of meta.keywords ?? []) {
    const keywordScore = tier(keyword.toLowerCase(), needle, 500);
    if (keywordScore !== null) return keywordScore;
  }

  const categoryScore = tier(meta.category.toLowerCase(), needle, 200);
  if (categoryScore !== null) return categoryScore;

  if (isSubsequence(title, needle)) return 100 - meta.title.length / 100;
  return null;
}
