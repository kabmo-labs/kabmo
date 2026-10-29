/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What a write MEANS: the calls it becomes, and how its outcome is reported.
 *
 * The per-host call table lives in `write-calls.ts`; this file is the layer
 * above it, and it holds the two facts the panel depends on:
 *
 * - **A verdict the host cannot express is refused here**, not sent as the
 *   nearest call. GitLab's only verdict endpoint is `/approve`, so a "request
 *   changes" that reached the wire would APPROVE the change the reviewer asked
 *   to block.
 * - **One intent can be two calls.** A GitLab approval that carries words is a
 *   note followed by the approval, because `/approve` takes no body — and a
 *   partial failure says which half landed.
 *
 * ## Every write is followed by an invalidation, not by a re-read
 *
 * A write changes the item AND the list it came from, and those are different
 * cached URLs. `invalidateWhere` drops every entry for the repository, which is
 * the whole set a write could have changed — so the panel's next read is real
 * instead of a 304 describing the state before the write.
 */

import type { ForgeItem, ForgeSection, ForgeWrite } from '../protocol';
import { authHeaders } from './http';
import { sendJson, type SendResult } from './write-http';
import { joinUrl, type ForgeContext } from './context';
import { commentBody, commentPath, mergeCall, reviewCall, stateCall, type Call } from './write-calls';

/**
 * Turn one write into the host calls it means, or a sentence explaining why not.
 *
 * A LIST because one intent can be two requests on one host: a GitLab approval
 * that carries words is a note and then the approval, since `/approve` takes no
 * body. A caller that sent only the approval would drop the reviewer's words.
 */
export function callsFor(
  context: ForgeContext,
  section: ForgeSection,
  id: string,
  write: ForgeWrite,
): Call[] | { error: string } {
  if (write.kind === 'comment') {
    const path = commentPath(context, section, id);
    if (!path) return { error: 'That repository is not addressable on this host.' };
    return [
      {
        url: joinUrl(context.apiBase, path),
        method: 'POST',
        body: commentBody(context, write.body),
        message: 'Comment posted.',
      },
    ];
  }
  if (write.kind === 'state') {
    const call = stateCall(context, section, id, write.state);
    return call ? [call] : { error: 'That repository is not addressable on this host.' };
  }
  if (write.kind === 'review') {
    const verdict = reviewCall(context, section, id, write.verdict, write.body);
    if ('error' in verdict) return verdict;
    // GitHub's `/reviews` and Gitea's carry the message in the verdict call;
    // GitLab's `/approve` and Bitbucket's take no body, so on those hosts the
    // words travel as a comment first or they are lost.
    const text = write.body.trim();
    const carriesBody = context.provider === 'github' || context.provider === 'gitea';
    if (text && !carriesBody) {
      const path = commentPath(context, section, id);
      if (!path) return { error: 'That repository is not addressable on this host.' };
      return [
        { url: joinUrl(context.apiBase, path), method: 'POST', body: commentBody(context, text), message: 'Comment posted.' },
        verdict,
      ];
    }
    return [verdict];
  }
  const call = mergeCall(context, section, id, write.method);
  return 'error' in call ? call : [call];
}

/** Perform one write. The caller has already checked `writeRefusal`. */
export async function performWrite(
  context: ForgeContext,
  section: ForgeSection,
  id: string,
  write: ForgeWrite,
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const calls = callsFor(context, section, id, write);
  if ('error' in calls) return { ok: false, message: calls.error };

  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index];
    const result: SendResult = await sendJson({
      url: call.url,
      method: call.method,
      body: call.body,
      headers: authHeaders(context.provider, context.token),
      // The SAME injected fetch the reads use, so a write is testable without a
      // network. Without this the whole write path could only be exercised
      // against a live repository — which is how a smoke run posted a real
      // comment.
      ...(context.fetchImpl ? { fetchImpl: context.fetchImpl } : {}),
    });
    if (!result.ok) {
      // A partial write says which half landed, because "it failed" over a
      // posted comment is a report the reader would reproduce to discover.
      const landed = calls.slice(0, index).map((done) => done.message);
      const prefix = landed.length > 0 ? `${landed.join(' ')} But then: ` : '';
      return { ok: false, message: `${prefix}${result.message}` };
    }
  }
  return { ok: true, message: calls[calls.length - 1].message };
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
