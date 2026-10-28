/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The four writes, per host.
 *
 * One table per verb rather than a chain of `if`s, because four hosts × four
 * verbs is sixteen shapes and a missed one is a button that silently does
 * nothing. Each row states the method, the path and the body — the only thing
 * that differs between hosts for the same intent.
 *
 * ## What is NOT shared, and why
 *
 * - **GitLab's "close" is `state_event: close`**, not `state: closed`. Sending
 *   the latter is accepted by the host and ignored, so the merge request stays
 *   open and the panel reports success.
 * - **Bitbucket has no comment body at the top level** — it is
 *   `{content: {raw}}` — and its state verbs are a POST to `.../decline` or
 *   `.../merge`, not a PATCH.
 * - **Gitea's merge takes the style in the body** (`Do: merge|squash|rebase`)
 *   while GitHub takes it in the path (`/merge`, `/merge/squash`… wait: GitHub
 *   uses `merge_method` in the body). Stated per row.
 * - **A review verdict is two events on GitHub, one on GitLab, none on
 *   Bitbucket.** `capabilities.ts` refuses the ones a host cannot express, so
 *   this table only ever sees a verb the host supports.
 *
 * ## Every write is followed by an invalidation, not by a re-read
 *
 * A write changes the item AND the list it came from, and those are different
 * cached URLs. `invalidateWhere` drops every entry for the repository, which is
 * the whole set a write could have changed — so the panel's next read is real
 * instead of a 304 describing the state before the write.
 */

import type { ForgeItem, ForgeProvider, ForgeSection, ForgeWrite } from '../protocol';
import { authHeaders } from './http';
import { sendJson, type SendResult } from './write-http';
import { bitbucketPath } from './remote';
import { joinUrl, type ForgeContext } from './context';

/** One host call a write becomes. */
interface Call {
  url: string;
  method: 'POST' | 'PATCH' | 'PUT';
  body: unknown;
  /** The sentence a success reports, when the host's own answer is not one. */
  message: string;
}

/** The path prefix for a section's items on each host. */
function itemPath(context: ForgeContext, section: ForgeSection, id: string): string | null {
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
function commentPath(context: ForgeContext, section: ForgeSection, id: string): string | null {
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
function commentBody(context: ForgeContext, body: string): unknown {
  return context.provider === 'bitbucket' ? { content: { raw: body } } : { body };
}

/** A state change, per host — and GitLab's is an EVENT, not a state. */
function stateCall(context: ForgeContext, section: ForgeSection, id: string, state: 'open' | 'closed'): Call | null {
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

/** A merge, per host: the method's spelling and the path both differ. */
function mergeCall(context: ForgeContext, section: ForgeSection, id: string, method: 'merge' | 'squash' | 'rebase'): Call | null {
  const path = itemPath(context, section, id);
  if (!path) return null;

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
  return {
    url: joinUrl(context.apiBase, `${path}/merge`),
    method: 'POST',
    body: method === 'merge' ? {} : { merge_strategy: method === 'squash' ? 'squash' : 'fast_forward' },
    message: 'Merged.',
  };
}

/** A review verdict, per host. */
function reviewCall(
  context: ForgeContext,
  section: ForgeSection,
  id: string,
  verdict: 'approve' | 'request_changes',
  body: string,
): Call | null {
  const path = itemPath(context, section, id);
  if (!path) return null;

  if (context.provider === 'github') {
    return {
      url: joinUrl(context.apiBase, `${path}/reviews`),
      method: 'POST',
      body: { event: verdict === 'approve' ? 'APPROVE' : 'REQUEST_CHANGES', ...(body ? { body } : {}) },
      message: verdict === 'approve' ? 'Approved.' : 'Changes requested.',
    };
  }
  if (context.provider === 'gitlab') {
    // Only `approve` reaches here: `capabilities.ts` refuses request-changes for
    // GitLab, because the host has no such event.
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
  // Bitbucket has no verdict: an approval is a POST to its own endpoint, and
  // `capabilities.ts` never offers request-changes here.
  return {
    url: joinUrl(context.apiBase, `${path}/approve`),
    method: 'POST',
    body: {},
    message: 'Approved.',
  };
}

/** Turn one write into the host call it means, or a sentence explaining why not. */
export function callFor(
  context: ForgeContext,
  section: ForgeSection,
  id: string,
  write: ForgeWrite,
): Call | { error: string } {
  if (write.kind === 'comment') {
    const path = commentPath(context, section, id);
    if (!path) return { error: 'That repository is not addressable on this host.' };
    return {
      url: joinUrl(context.apiBase, path),
      method: 'POST',
      body: commentBody(context, write.body),
      message: 'Comment posted.',
    };
  }
  if (write.kind === 'state') {
    const call = stateCall(context, section, id, write.state);
    return call ?? { error: 'That repository is not addressable on this host.' };
  }
  if (write.kind === 'review') {
    const call = reviewCall(context, section, id, write.verdict, write.body);
    return call ?? { error: 'That repository is not addressable on this host.' };
  }
  const call = mergeCall(context, section, id, write.method);
  return call ?? { error: 'That repository is not addressable on this host.' };
}

/** Perform one write. The caller has already checked `writeRefusal`. */
export async function performWrite(
  context: ForgeContext,
  section: ForgeSection,
  id: string,
  write: ForgeWrite,
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const call = callFor(context, section, id, write);
  if ('error' in call) return { ok: false, message: call.error };

  const result: SendResult = await sendJson({
    url: call.url,
    method: call.method,
    body: call.body,
    headers: authHeaders(context.provider, context.token),
    // The SAME injected fetch the reads use, so a write is testable without a
    // network. Without this the whole write path could only be exercised against
    // a live repository — which is how a smoke run posted a real comment.
    ...(context.fetchImpl ? { fetchImpl: context.fetchImpl } : {}),
  });
  if (!result.ok) return { ok: false, message: result.message };
  return { ok: true, message: call.message };
}

/** The item a write answers with, so the panel can repaint without a read. */
export function patchedItem(item: ForgeItem, write: ForgeWrite): ForgeItem {
  if (write.kind === 'state') {
    return { ...item, state: write.state === 'closed' ? 'closed' : 'open' };
  }
  if (write.kind === 'merge') return { ...item, state: 'merged' };
  if (write.kind === 'comment') return { ...item, comments: item.comments + 1 };
  return item;
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
