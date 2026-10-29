/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Facts about a host that more than one module needs: its display name, and the
 * merge styles it can actually perform.
 *
 * Its own module because both `capabilities.ts` (what the panel may OFFER) and
 * `writes.ts` (what a request may SEND) must agree, and importing either from the
 * other made the two files a cycle. One table, two readers.
 */

import type { ForgeMergeMethod, ForgeProvider, ForgeReviewVerdict } from '../protocol';

/**
 * The merge styles each host can perform.
 *
 * Stated per host because the vocabulary is not shared, and a style a host
 * cannot express is NOT a preference:
 *
 * - **GitLab has no rebase-only merge.** `PUT …/merge` takes `squash`, so
 *   offering "rebase" there sends `{squash: false}` — an ordinary merge commit
 *   while the confirmation promised no merge commit.
 * - **Bitbucket's fast-forward is not a rebase.** It replays nothing; it only
 *   allows the merge when the target can move forward. So its three strategies
 *   are `merge_commit`, `squash` and `fast_forward`, and "rebase" has no
 *   equivalent there.
 * - GitHub and Gitea both take a real `rebase` style.
 */
const MERGE_METHODS: Record<ForgeProvider, readonly ForgeMergeMethod[]> = {
  github: ['merge', 'squash', 'rebase'],
  gitlab: ['merge', 'squash'],
  gitea: ['merge', 'squash', 'rebase'],
  bitbucket: ['merge', 'squash'],
};

/** The merge styles a host can perform for a pull or merge request. */
export function mergeMethodsFor(provider: ForgeProvider): readonly ForgeMergeMethod[] {
  return MERGE_METHODS[provider];
}

/**
 * The review verdicts each host can express, for THIS panel.
 *
 * **GitLab has one event, not two.** It has `approve` and a note; there is no
 * "request changes" endpoint, so offering the button produces a refusal at best.
 * GitHub and Gitea take a verdict on one review call, message included.
 *
 * **Bitbucket has none**, and that is about the panel rather than the host: its
 * `/approve` and `/request-changes` endpoints exist but take NO message, so a
 * verdict from this panel would silently drop the words the reviewer typed. The
 * comment box is the honest way to say it there.
 */
const REVIEW_VERDICTS: Record<ForgeProvider, readonly ForgeReviewVerdict[]> = {
  github: ['approve', 'request_changes'],
  gitlab: ['approve'],
  gitea: ['approve', 'request_changes'],
  bitbucket: [],
};

/** The review verdicts a host can express on a pull or merge request. */
export function reviewVerdictsFor(provider: ForgeProvider): readonly ForgeReviewVerdict[] {
  return REVIEW_VERDICTS[provider];
}

/** The provider's display name, for a sentence that has to name it. */
export function providerLabel(provider: ForgeProvider): string {
  return provider === 'github'
    ? 'GitHub'
    : provider === 'gitlab'
      ? 'GitLab'
      : provider === 'gitea'
        ? 'Gitea'
        : 'Bitbucket';
}
