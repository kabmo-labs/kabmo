/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What a read may OFFER to do, from what it can prove.
 *
 * A button that can only fail is worse than no button, so the panel asks this
 * table rather than assuming: a public repository read anonymously has no
 * credential to comment with, and every host refuses a write without one. That
 * one fact removes all four capabilities at once.
 *
 * The rest is per host and per section, and each row is a real API limit rather
 * than a preference:
 *
 * - **GitLab has no "request changes".** It has `approve` and it has a note; the
 *   review verdict GitHub models with two events has one event there, so
 *   `review` is offered for approve and `request_changes` is refused by name.
 * - **A release is not a discussion on any host.** No comments, no state, no
 *   merge — it is a published artifact with an edit form, and editing it is not
 *   what this panel is for.
 * - **Bitbucket's issues have no review concept at all**, only pull requests do.
 * - **Gitea needs the merge style on the request** and has no `rebase`-only
 *   option in older versions, so `rebase` is offered and the host's own refusal
 *   is surfaced if it does not support it.
 */

import type { ForgeCapabilities, ForgeProvider, ForgeSection, ForgeWrite } from '../protocol';
import { readOnly } from '../protocol';

export interface CapabilityInput {
  provider: ForgeProvider;
  section: ForgeSection;
  /** A credential is present. Every host requires one to write. */
  hasCredential: boolean;
}

/** Whether a host can comment on a section at all. */
function commentable(provider: ForgeProvider, section: ForgeSection): boolean {
  if (section === 'releases') return false;
  // Bitbucket's issues endpoint takes comments; Gitea's and GitHub's do too,
  // through the same `/issues/:id/comments` shape.
  return provider === 'github' || provider === 'gitlab' || provider === 'gitea' || provider === 'bitbucket';
}

/** What this read may do. */
export function capabilitiesFor(input: CapabilityInput): ForgeCapabilities {
  if (!input.hasCredential) return readOnly();
  const { provider, section } = input;
  if (section === 'releases') return readOnly();

  const isPull = section === 'pulls';
  return {
    comment: commentable(provider, section),
    state: true,
    // Only a pull request has a review, and only two of the four hosts model a
    // verdict as an event; GitLab and Bitbucket approve without a verdict.
    review: isPull && provider !== 'bitbucket',
    merge: isPull,
  };
}

/**
 * Whether one write is offered, with the sentence explaining a refusal.
 *
 * The panel calls this before it opens a dialog, so a refused action never
 * reaches the host: the reason names what is missing instead of surfacing a 403
 * from an API the reader did not know was involved.
 */
export function writeRefusal(
  write: ForgeWrite,
  input: CapabilityInput,
): { ok: true } | { ok: false; reason: string } {
  const capabilities = capabilitiesFor(input);

  if (!input.hasCredential) {
    return {
      ok: false,
      reason: 'This needs a credential. Set GITHUB_TOKEN / GITLAB_TOKEN in the server environment, or run `gh` / `glab` auth login.',
    };
  }
  if (input.section === 'releases') {
    return { ok: false, reason: 'A release is not a discussion: it has no comments, state or merge.' };
  }
  if (write.kind === 'merge' && !capabilities.merge) {
    return { ok: false, reason: 'Only a pull or merge request can be merged.' };
  }
  if (write.kind === 'review' && !capabilities.review) {
    return {
      ok: false,
      reason:
        input.provider === 'bitbucket'
          ? 'Bitbucket has no review verdict; approve the pull request instead.'
          : 'Only a pull or merge request can be reviewed.',
    };
  }
  if (write.kind === 'review' && write.verdict === 'request_changes' && input.provider === 'gitlab') {
    return {
      ok: false,
      reason: 'GitLab has no "request changes" event. Add a comment saying what must change, or approve it.',
    };
  }
  return { ok: true };
}
