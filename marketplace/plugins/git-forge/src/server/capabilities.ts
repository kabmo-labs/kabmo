/**
 * @license
 * SPDX-License-Identifier: MIT
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
 *   `reviewVerdicts` carries `approve` alone.
 * - **A release is not a discussion on any host.** No comments, no state, no
 *   merge — it is a published artifact with an edit form, and editing it is not
 *   what this panel is for.
 * - **Bitbucket's issues have no review concept at all**, only pull requests do.
 * - **No host merges by rebase except GitHub and Gitea**, so the merge styles are
 *   a list rather than a boolean (see `provider.ts`).
 */

import type { ForgeCapabilities, ForgeProvider, ForgeSection, ForgeWrite } from '../protocol';
import { readOnly } from '../protocol';
import { mergeMethodsFor, providerLabel, reviewVerdictsFor } from './provider';

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
  const verdicts = isPull ? reviewVerdictsFor(provider) : [];
  return {
    comment: commentable(provider, section),
    state: true,
    // Only a pull request has a review, and Bitbucket's issues have no verdict
    // at all — the list carries which verdicts the host can express.
    review: isPull && verdicts.length > 0,
    merge: isPull,
    mergeMethods: isPull ? [...mergeMethodsFor(provider)] : [],
    reviewVerdicts: [...verdicts],
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
  if (write.kind === 'merge' && !capabilities.mergeMethods.includes(write.method)) {
    // The host cannot express this style, and the nearest thing it CAN do is a
    // different operation: GitLab would send an ordinary merge commit for
    // "rebase", Bitbucket a fast-forward. Refused by name instead.
    return {
      ok: false,
      reason: `${providerLabel(input.provider)} cannot merge with "${write.method}". Use ${capabilities.mergeMethods.join(' or ')}.`,
    };
  }
  if (write.kind === 'review' && !capabilities.review) {
    return {
      ok: false,
      reason:
        input.section === 'pulls'
          ? `${providerLabel(input.provider)} has no review verdict this panel can post: its endpoints take no message. Add a comment instead.`
          : 'Only a pull or merge request can be reviewed.',
    };
  }
  if (write.kind === 'review' && !capabilities.reviewVerdicts.includes(write.verdict)) {
    // GitLab has `approve` and nothing else: "request changes" is not an event
    // there, so the sentence names the alternative rather than the failure.
    return {
      ok: false,
      reason: `${providerLabel(input.provider)} has no "${write.verdict.replace('_', ' ')}" event. Add a comment saying what must change, or approve it.`,
    };
  }
  return { ok: true };
}
