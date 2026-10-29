/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The write table, over all four hosts.
 *
 * `callsFor` is pure — it turns an intent into URLs, methods and bodies — so
 * every row can be asserted exactly. That matters because each host spells the
 * same verb differently and three of the differences are SILENT when wrong:
 *
 * - GitLab's close is `state_event: close`; sending `state: closed` is accepted
 *   and ignored, so the merge request stays open while the panel reports success.
 * - Bitbucket has no comment body at the top level (`{content: {raw}}`) and no
 *   state field on a pull request (a POST to `/decline`).
 * - Gitea's merge style is `Do: merge|squash|rebase`, not a `merge_method`.
 * - GitLab and Bitbucket have no rebase merge, and GitLab's `/approve` takes no
 *   message — so a review with words there is a comment and then the verdict.
 *
 * `performWrite` is driven through the injected fetch, so nothing here can reach
 * a real repository. That is deliberate: the first version of this suite was a
 * live smoke, and it posted a comment to a public project.
 */

import { describe, expect, test } from 'bun:test';

import { callsFor, patchedItem, performWrite } from './writes';
import { providerLabel } from './provider';
import { hostContext } from './test-context';
import type { ForgeItem, ForgeProvider, ForgeSection, ForgeWrite } from '../protocol';

/** A fetch that records one request and answers 200 with `body`. */
function recorder(body: unknown = {}) {
  const seen: Array<{ url: string; method?: string; body?: unknown; headers?: Record<string, string> }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({
      url: String(input),
      method: init?.method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}

/** The calls one write becomes, or the refusal. */
const calls = (provider: ForgeProvider, write: ForgeWrite, section: ForgeSection = 'pulls') => {
  const { fetchImpl } = recorder();
  return callsFor(hostContext(provider, fetchImpl), section, '12', write);
};

/** The single call a write becomes, which is every verb but a review with words. */
const call = (provider: ForgeProvider, write: ForgeWrite, section: ForgeSection = 'pulls') => {
  const outcome = calls(provider, write, section);
  if ('error' in outcome) return outcome;
  if (outcome.length !== 1) throw new Error(`expected one call, got ${outcome.length}`);
  return outcome[0];
};

describe('callFor — a comment', () => {
  test('GitHub and Gitea use /issues/:id/comments, because a pull request is an issue', () => {
    for (const provider of ['github', 'gitea'] as const) {
      const result = call(provider, { kind: 'comment', body: 'hello' });
      if ('error' in result) throw new Error(result.error);
      expect(result.url).toContain('/issues/12/comments');
      expect(result.body).toEqual({ body: 'hello' });
      expect(result.method).toBe('POST');
    }
  });

  test('GitLab says notes', () => {
    const result = call('gitlab', { kind: 'comment', body: 'hello' });
    if ('error' in result) throw new Error(result.error);
    expect(result.url).toContain('/merge_requests/12/notes');
    expect(result.body).toEqual({ body: 'hello' });
  });

  test('Bitbucket nests the body under content.raw', () => {
    const result = call('bitbucket', { kind: 'comment', body: 'hello' });
    if ('error' in result) throw new Error(result.error);
    expect(result.url).toContain('/pullrequests/12/comments');
    expect(result.body).toEqual({ content: { raw: 'hello' } });
  });
});

describe('callFor — a state change', () => {
  test('GitLab sends an EVENT, not a state, or the close is silently ignored', () => {
    const result = call('gitlab', { kind: 'state', state: 'closed' });
    if ('error' in result) throw new Error(result.error);
    expect(result.body).toEqual({ state_event: 'close' });
    expect(result.method).toBe('PUT');

    const reopen = call('gitlab', { kind: 'state', state: 'open' });
    if ('error' in reopen) throw new Error(reopen.error);
    expect(reopen.body).toEqual({ state_event: 'reopen' });
  });

  test('GitHub and Gitea PATCH a state', () => {
    for (const provider of ['github', 'gitea'] as const) {
      const result = call(provider, { kind: 'state', state: 'closed' });
      if ('error' in result) throw new Error(result.error);
      expect(result.method).toBe('PATCH');
      expect(result.body).toEqual({ state: 'closed' });
    }
  });

  test('Bitbucket declines a pull request and PATCHes an issue', () => {
    const pull = call('bitbucket', { kind: 'state', state: 'closed' });
    if ('error' in pull) throw new Error(pull.error);
    expect(pull.url).toContain('/pullrequests/12/decline');
    expect(pull.method).toBe('POST');

    const issue = call('bitbucket', { kind: 'state', state: 'closed' }, 'issues');
    if ('error' in issue) throw new Error(issue.error);
    expect(issue.method).toBe('PUT');
    expect(issue.body).toEqual({ state: 'closed' });
  });
});

describe('callsFor — a merge', () => {
  test('each host takes the style its own way', () => {
    const github = call('github', { kind: 'merge', method: 'squash' });
    if ('error' in github) throw new Error(github.error);
    expect(github.body).toEqual({ merge_method: 'squash' });
    expect(github.method).toBe('PUT');

    const gitea = call('gitea', { kind: 'merge', method: 'rebase' });
    if ('error' in gitea) throw new Error(gitea.error);
    expect(gitea.body).toEqual({ Do: 'rebase' });
    expect(gitea.method).toBe('POST');

    const gitlab = call('gitlab', { kind: 'merge', method: 'squash' });
    if ('error' in gitlab) throw new Error(gitlab.error);
    expect(gitlab.body).toEqual({ squash: true });

    // Bitbucket's strategy is stated, never left to the repository default: an
    // omitted `merge_strategy` follows the repo setting, so "Merge commit" could
    // fast-forward.
    const bitbucket = call('bitbucket', { kind: 'merge', method: 'merge' });
    if ('error' in bitbucket) throw new Error(bitbucket.error);
    expect(bitbucket.body).toEqual({ merge_strategy: 'merge_commit' });
    expect(bitbucket.method).toBe('POST');
  });

  test('a style the host cannot perform is refused, not substituted', () => {
    for (const provider of ['gitlab', 'bitbucket'] as const) {
      const result = calls(provider, { kind: 'merge', method: 'rebase' });
      expect('error' in result).toBe(true);
      if (!('error' in result)) continue;
      expect(result.error).toContain('cannot merge with "rebase"');
      expect(result.error).toContain('merge or squash');
    }
  });
});

describe('callsFor — a review', () => {
  test('GitHub sends an event; GitLab and Bitbucket POST approve', () => {
    const github = call('github', { kind: 'review', verdict: 'request_changes', body: 'why' });
    if ('error' in github) throw new Error(github.error);
    expect(github.url).toContain('/reviews');
    expect(github.body).toEqual({ event: 'REQUEST_CHANGES', body: 'why' });

    const gitlab = call('gitlab', { kind: 'review', verdict: 'approve', body: '' });
    if ('error' in gitlab) throw new Error(gitlab.error);
    expect(gitlab.url).toContain('/approve');
    expect(gitlab.body).toEqual({});
  });

  test('words typed with a GitLab approval are posted as a note, because /approve takes no body', () => {
    const outcome = calls('gitlab', { kind: 'review', verdict: 'approve', body: '  Looks right  ' });
    if ('error' in outcome) throw new Error(outcome.error);
    expect(outcome).toHaveLength(2);
    expect(outcome[0].url).toContain('/merge_requests/12/notes');
    expect(outcome[0].body).toEqual({ body: 'Looks right' });
    expect(outcome[1].url).toContain('/merge_requests/12/approve');
  });

  test('a GitHub review carries its own body, so it stays one call', () => {
    const outcome = calls('github', { kind: 'review', verdict: 'approve', body: 'fine' });
    if ('error' in outcome) throw new Error(outcome.error);
    expect(outcome).toHaveLength(1);
    expect(outcome[0].body).toEqual({ event: 'APPROVE', body: 'fine' });
  });

  test('a verdict the host has no event for is refused', () => {
    const result = calls('gitlab', { kind: 'review', verdict: 'request_changes', body: 'why' });
    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.error).toContain('no "request changes" event');
  });
});

describe('callsFor — a section that has no write', () => {
  test('a release is not addressable, and the sentence says so', () => {
    const result = call('github', { kind: 'comment', body: 'x' }, 'releases');
    expect('error' in result).toBe(true);
  });
});

describe('performWrite', () => {
  test('it sends exactly what the table said, through the injected fetch', async () => {
    const { seen, fetchImpl } = recorder({ id: 1 });
    const context = hostContext('github', fetchImpl);
    const result = await performWrite(context, 'pulls', '12', { kind: 'merge', method: 'squash' });

    expect(result).toEqual({ ok: true, message: 'Merged.' });
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe('PUT');
    expect(seen[0].url).toBe('https://api.github.com/repos/kabmo-labs/kabmo/pulls/12/merge');
    expect(seen[0].body).toEqual({ merge_method: 'squash' });
    // The credential rides the same header the reads use.
    expect(seen[0].headers?.authorization).toBe('Bearer token_test');
  });

  test('a refused write reports the host sentence, not a throw', async () => {
    const fetchImpl = (async () => new Response('{}', { status: 405 })) as unknown as typeof fetch;
    const result = await performWrite(hostContext('github', fetchImpl), 'pulls', '12', {
      kind: 'merge',
      method: 'merge',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('405');
  });

  test('a host with no route for the verb reports it without a request', async () => {
    const { seen, fetchImpl } = recorder();
    const result = await performWrite(hostContext('github', fetchImpl), 'releases', 'v1', {
      kind: 'comment',
      body: 'x',
    });
    expect(result.ok).toBe(false);
    expect(seen).toHaveLength(0);
  });
});

describe('patchedItem', () => {
  const item: ForgeItem = {
    id: '12',
    number: 12,
    title: 't',
    state: 'open',
    author: 'a',
    updatedAt: '',
    url: 'u',
    labels: [],
    comments: 3,
    tag: null,
  };

  test('a state change and a merge land on the item the panel repaints', () => {
    expect(patchedItem(item, { kind: 'state', state: 'closed' }).state).toBe('closed');
    expect(patchedItem(item, { kind: 'merge', method: 'squash' }).state).toBe('merged');
    expect(patchedItem(item, { kind: 'comment', body: 'x' }).comments).toBe(4);
    expect(patchedItem(item, { kind: 'review', verdict: 'approve', body: '' })).toBe(item);
  });
});

describe('providerLabel', () => {
  test('every provider has a name a sentence can use', () => {
    for (const provider of ['github', 'gitlab', 'gitea', 'bitbucket'] as const) {
      expect(providerLabel(provider)).not.toBe(provider);
    }
  });
});

describe('performWrite — a two-call write', () => {
  test('a GitLab approval with words sends the note first, then the approve', async () => {
    const { seen, fetchImpl } = recorder({});
    const result = await performWrite(hostContext('gitlab', fetchImpl), 'pulls', '7', {
      kind: 'review',
      verdict: 'approve',
      body: 'Ship it',
    });

    expect(result).toEqual({ ok: true, message: 'Approved.' });
    expect(seen.map((entry) => entry.url)).toEqual([
      'https://gitlab.com/api/v4/projects/group%2Fproject/merge_requests/7/notes',
      'https://gitlab.com/api/v4/projects/group%2Fproject/merge_requests/7/approve',
    ]);
  });

  test('a failure in the second call says what already landed', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return calls === 1 ? new Response('{}', { status: 201 }) : new Response('{}', { status: 403 });
    }) as unknown as typeof fetch;
    const result = await performWrite(hostContext('gitlab', fetchImpl), 'pulls', '7', {
      kind: 'review',
      verdict: 'approve',
      body: 'Ship it',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('Comment posted.');
    expect(result.message).toContain('403');
  });
});
