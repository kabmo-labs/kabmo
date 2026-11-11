/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Provider-aware grouping for the generic quota section.
 *
 * omp reports every provider's windows as one flat list, but three of them are
 * not one list:
 *
 *  - Anthropic mixes plan windows (5h, 7d, per-tier 7d) with a USD spend limit
 *    (`anthropic:extra`). Drawing the spend limit as a fourth quota window made
 *    it look like another reset window instead of "what happens after the
 *    windows run out".
 *  - Antigravity emits one entry per model family AND per window, so a Google
 *    bucket and the shared Claude/GPT bucket sat in one grid with no boundary;
 *    the rows even repeat the family in their label because there was nowhere
 *    else to put it.
 *  - Every other provider is one list, and stays one list.
 *
 * The grouping is a pure function of (provider slug, limit id) so it can be
 * unit-tested without mounting the panel. Group order is first-seen order and
 * rows keep omp's own order inside a group (omp sorts by remaining fraction).
 */

import type { UsageLimitWindow } from '@/shared/types';

export interface LimitGroup {
  /** Stable key inside one provider's section: `windows`, `balance`, `google`, … */
  id: string;
  /** The group's own heading; the panel draws one heading per group. */
  title: string;
  limits: UsageLimitWindow[];
}

const CLAUDE_EXTRA_ID = 'anthropic:extra';
const QUOTA_TITLE = 'Quota windows';

/** Push a row into the group named `id`, creating it on first use. */
function push(
  groups: LimitGroup[],
  id: string,
  title: string,
  limit: UsageLimitWindow,
): void {
  const existing = groups.find((group) => group.id === id);
  if (existing) {
    existing.limits.push(limit);
    return;
  }
  groups.push({ id, title, limits: [limit] });
}

/**
 * The model family Antigravity put in the second segment of the limit id:
 * `${provider}:${counterKey}:${tier}:${windowId}`. `anthropic` and `openai`
 * share one upstream bucket, which omp labels "Claude & GPT (shared)".
 */
function antigravityBucket(id: string): { id: string; title: string } {
  const counter = (id.split(':')[1] ?? '').toLowerCase();
  if (counter === 'google') return { id: 'google', title: 'Google' };
  if (counter === 'anthropic' || counter === 'openai') {
    return { id: 'third-party', title: 'Claude & GPT (shared)' };
  }
  if (counter === 'default' || counter === '') return { id: 'default', title: 'Usage' };
  // An unknown counter still has to be visible; naming it beats dropping it.
  return { id: counter, title: counter };
}

/** Split Claude's plan windows from its USD spend limit. */
function groupClaude(limits: UsageLimitWindow[]): LimitGroup[] {
  const groups: LimitGroup[] = [];
  for (const limit of limits) {
    if (limit.id === CLAUDE_EXTRA_ID) push(groups, 'balance', 'Balance', limit);
    else push(groups, 'windows', QUOTA_TITLE, limit);
  }
  return groups;
}

/** Group Antigravity's rows by model family, merging the shared third-party bucket. */
function groupAntigravity(limits: UsageLimitWindow[]): LimitGroup[] {
  const groups: LimitGroup[] = [];
  for (const limit of limits) {
    const bucket = antigravityBucket(limit.id);
    // The quota-summary response emits the SAME shared bucket once for
    // `anthropic:` and once for `openai:` — identical label, amount and reset,
    // only the id differs. Rendering both would show the same number twice under
    // one heading; the first row is the whole fact.
    if (bucket.id === 'third-party') {
      const shared = groups.find((group) => group.id === 'third-party');
      if (shared?.limits.some((row) => isSameReading(row, limit))) continue;
    }
    push(groups, bucket.id, bucket.title, limit);
  }
  return groups;
}

/** Whether two rows describe the same reading of the same bucket. */
function isSameReading(a: UsageLimitWindow, b: UsageLimitWindow): boolean {
  return a.unit === b.unit
    && a.label === b.label
    && a.usedFraction === b.usedFraction
    && a.remaining === b.remaining
    && a.resetsAt === b.resetsAt;
}

/**
 * The panel's sections for one provider: one group for an ordinary provider,
 * two for Claude (windows + balance), and one per model family for Antigravity.
 */
export function groupProviderLimits(providerId: string, limits: UsageLimitWindow[]): LimitGroup[] {
  if (limits.length === 0) return [];
  const slug = providerId.trim().toLowerCase();
  if (slug === 'anthropic') return groupClaude(limits);
  if (slug === 'google-antigravity') return groupAntigravity(limits);
  return [{ id: 'all', title: QUOTA_TITLE, limits: [...limits] }];
}
