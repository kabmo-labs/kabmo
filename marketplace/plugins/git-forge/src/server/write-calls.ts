/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The per-host call table: what one intent becomes on each API.
 *
 * Split from `writes.ts` because the two answer different questions — this file
 * knows the URL, the method and the body for each host, and `writes.ts` knows
 * which intents the panel may send and how a failure is reported. A single file
 * carrying both crossed the project's file ceiling, and the table is the half
 * that grows with every host added.
 *
 * Three differences here are SILENT when wrong:
 *
 * - **GitLab's "close" is `state_event: close`**, not `state: closed`. Sending
 *   the latter is accepted by the host and ignored, so the merge request stays
 *   open while the panel reports success.
 * - **Bitbucket has no comment body at the top level** — it is
 *   `{content: {raw}}` — and its state verbs are a POST to `.../decline`, not a
 *   PATCH.
 * - **Gitea's merge takes the style in the body** (`Do: merge|squash|rebase`).
 *
 * Every write is followed by an invalidation, not by a re-read; that lives in
 * `writes.ts`.
 */

import type { ForgeMergeMethod, ForgeReviewVerdict, ForgeSection } from '../protocol';
import { bitbucketPath } from './remote';
import { joinUrl, type ForgeContext } from './context';
import { mergeMethodsFor, providerLabel, reviewVerdictsFor } from './provider';

/** One host call a write becomes. */
export interface Call {
  url: string;
  method: 'POST' | 'PATCH' | 'PUT';
  body: unknown;
  /** The sentence a success reports, when the host's own answer is not one. */
  message: string;
}

/** The path prefix for a section's items on each host. */
export function itemPath(context: ForgeContext, section: ForgeSection, id: string): string | null {
  const encoded = encodeURIComponent(id);
  if (context.provider === 'github') {
    const base = `/repos/${context.slug}`;
    if (section === 'issues') return `${base}/issues/${encoded}`;
    if (section === 'pulls') return `${base}/pulls/${encoded}`;
    return null;
  }
  if (context.provider === 'gitlab') {
    const project = `projects/${encodeURIComponent(context.slug)}`;
    if (section === 'issues') return `${project}/issues/${encoded}`;
    if (section === 'pulls') return `${project}/merge_requests/${encoded}`;
    return null;
  }
  if (context.provider === 'gitea') {
    const base = `/repos/${context.slug}`;
    if (section === 'issues') return `${base}/issues/${encoded}`;
    if (section === 'pulls') return `${base}/pulls/${encoded}`;
    return null;
  }
  const parts = bitbucketPath(context.slug);
  if (!parts) return null;
  const repo = `repositories/${encodeURIComponent(parts.workspace)}/${encodeURIComponent(parts.repo)}`;
  if (section === 'issues') return `${repo}/issues/${encoded}`;
  if (section === 'pulls') return `${repo}/pullrequests/${encoded}`;
  return null;
}

/** The comment collection for an item, which every host puts under its own noun. */
export function commentPath(context: ForgeContext, section: ForgeSection, id: string): string | null {
  // A release is not a discussion on any host: it has no comment collection, so
  // asking for one must not fall through to `/issues/:id/comments` — which is a
  // 404 at best and, on a host that numbers releases, somebody else's issue.
  if (section === 'releases') return null;
  const encoded = encodeURIComponent(id);
  if (context.provider === 'github') return `/repos/${context.slug}/issues/${encoded}/comments`;
  if (context.provider === 'gitlab') {
    const kind = section === 'issues' ? 'issues' : 'merge_requests';
    return `projects/${encodeURIComponent(context.slug)}/${kind}/${encoded}/notes`;
  }
  if (context.provider === 'gitea') return `/repos/${context.slug}/issues/${encoded}/comments`;
  const parts = bitbucketPath(context.slug);
  if (!parts) return null;
  const repo = `repositories/${encodeURIComponent(parts.workspace)}/${encodeURIComponent(parts.repo)}`;
  const kind = section === 'pulls' ? 'pullrequests' : 'issues';
  return `${repo}/${kind}/${encoded}/comments`;
}

/** A comment's body, per host. */
export function commentBody(context: ForgeContext, body: string): unknown {
  return context.provider === 'bitbucket' ? { content: { raw: body } } : { body };
}

/** A state change, per host — and GitLab's is an EVENT, not a state. */
export function stateCall(context: ForgeContext, section: ForgeSection, id: string, state: 'open' | 'closed'): Call | null {
  const path = itemPath(context, section, id);
  if (!path) return null;
  const opening = state === 'open';

  if (context.provider === 'gitlab') {
    const event = section === 'pulls' ? (opening ? 'reopen' : 'close') : opening ? 'reopen' : 'close';
    return {
      url: joinUrl(context.apiBase, path),
      method: 'PUT',
      body: { state_event: event },
      message: opening ? 'Reopened.' : 'Closed.',
    };
  }
  if (context.provider === 'gitea') {
    return {
      url: joinUrl(context.apiBase, path),
      method: 'PATCH',
      body: { state },
      message: opening ? 'Reopened.' : 'Closed.',
    };
  }
  if (context.provider === 'bitbucket') {
    // Bitbucket has no state field: closing a pull request is a POST to its own
    // verb, and an ISSUE is closed by a PUT with a state word. There is no
    // reopen verb for a declined pull request, and `capabilities.ts` does not
    // offer one — the panel only ever asks for `closed` here.
    if (section === 'pulls') {
      return {
        url: joinUrl(context.apiBase, `${path}/decline`),
        method: 'POST',
        body: {},
        message: 'Declined.',
      };
    }
    return {
      url: joinUrl(context.apiBase, path),
      method: 'PUT',
      body: { state: opening ? 'open' : 'closed' },
      message: opening ? 'Reopened.' : 'Closed.',
    };
  }
  return {
    url: joinUrl(context.apiBase, path),
    method: 'PATCH',
    body: { state },
    message: opening ? 'Reopened.' : 'Closed.',
  };
}

/**
 * A merge, per host: the method's spelling and the path both differ.
 *
 * A style the host cannot perform is an ERROR, not the nearest-looking request:
 * GitLab has no rebase-only merge, so sending `{squash: false}` there would make
 * an ordinary merge commit while the confirmation promised none — and Bitbucket's
 * fast-forward is a different operation from a rebase. `capabilities.ts` owns the
 * table; this refuses against it rather than inventing a second copy.
 */
export function mergeCall(
  context: ForgeContext,
  section: ForgeSection,
  id: string,
  method: ForgeMergeMethod,
): Call | { error: string } {
  const path = itemPath(context, section, id);
  if (!path) return { error: 'That repository is not addressable on this host.' };
  if (!mergeMethodsFor(context.provider).includes(method)) {
    return {
      error: `${providerLabel(context.provider)} cannot merge with "${method}". Use ${mergeMethodsFor(context.provider).join(' or ')}.`,
    };
  }

  if (context.provider === 'github') {
    return {
      url: joinUrl(context.apiBase, `${path}/merge`),
      method: 'PUT',
      body: { merge_method: method },
      message: 'Merged.',
    };
  }
  if (context.provider === 'gitlab') {
    return {
      url: joinUrl(context.apiBase, `${path}/merge`),
      method: 'PUT',
      body: method === 'merge' ? {} : { squash: method === 'squash' },
      message: 'Merged.',
    };
  }
  if (context.provider === 'gitea') {
    return {
      url: joinUrl(context.apiBase, `${path}/merge`),
      method: 'POST',
      body: { Do: method },
      message: 'Merged.',
    };
  }
  // Bitbucket's strategy is stated rather than left to the repository's default:
  // an omitted `merge_strategy` follows the repo setting, which is how "Merge
  // commit" silently fast-forwarded. There is no rebase strategy at all.
  return {
    url: joinUrl(context.apiBase, `${path}/merge`),
    method: 'POST',
    body: { merge_strategy: method === 'squash' ? 'squash' : 'merge_commit' },
    message: 'Merged.',
  };
}

/** A review verdict, per host. */
export function reviewCall(
  context: ForgeContext,
  section: ForgeSection,
  id: string,
  verdict: ForgeReviewVerdict,
  body: string,
): Call | { error: string } {
  const path = itemPath(context, section, id);
  if (!path) return { error: 'That repository is not addressable on this host.' };
  if (!reviewVerdictsFor(context.provider).includes(verdict)) {
    // The host has no such event, and the nearest call is a DIFFERENT action:
    // GitLab's only verdict endpoint is `/approve`, so "request changes" there
    // would approve the change the reviewer asked to block.
    return {
      error: `${providerLabel(context.provider)} has no "${verdict.replace('_', ' ')}" event. Add a comment saying what must change, or approve it.`,
    };
  }

  if (context.provider === 'github') {
    return {
      url: joinUrl(context.apiBase, `${path}/reviews`),
      method: 'POST',
      body: { event: verdict === 'approve' ? 'APPROVE' : 'REQUEST_CHANGES', ...(body ? { body } : {}) },
      message: verdict === 'approve' ? 'Approved.' : 'Changes requested.',
    };
  }
  if (context.provider === 'gitlab') {
    return {
      url: joinUrl(context.apiBase, `${path}/approve`),
      method: 'POST',
      body: {},
      message: 'Approved.',
    };
  }
  if (context.provider === 'gitea') {
    return {
      url: joinUrl(context.apiBase, `${path}/reviews`),
      method: 'POST',
      body: { event: verdict === 'approve' ? 'APPROVED' : 'REQUEST_CHANGES', ...(body ? { body } : {}) },
      message: verdict === 'approve' ? 'Approved.' : 'Changes requested.',
    };
  }
  // Bitbucket is unreachable from here: `provider.ts` gives it no verdicts,
  // because its `/approve` and `/request-changes` endpoints take no message and
  // this panel's review carries one.
  return { error: 'That repository is not addressable on this host.' };
}
