/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The write table, over all four hosts.
 *
 * `callFor` is pure — it turns an intent into a URL, a method and a body — so
 * every row can be asserted exactly. That matters because each host spells the
 * same verb differently and three of the differences are SILENT when wrong:
 *
 * - GitLab's close is `state_event: close`; sending `state: closed` is accepted
 *   and ignored, so the merge request stays open while the panel reports success.
 * - Bitbucket has no comment body at the top level (`{content: {raw}}`) and no
 *   state field on a pull request (a POST to `/decline`).
 * - Gitea's merge style is `Do: merge|squash|rebase`, not a `merge_method`.
 *
 * `performWrite` is driven through the injected fetch, so nothing here can reach
 * a real repository. That is deliberate: the first version of this suite was a
 * live smoke, and it posted a comment to a public project.
 */

import { describe, expect, test } from 'bun:test';

import { callFor, patchedItem, performWrite, providerLabel } from './writes';
import { hostContext } from './test-context';
import type { ForgeItem, ForgeProvider } from '../protocol';

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

const call = (provider: ForgeProvider, write: Parameters<typeof callFor>[3], section: Parameters<typeof callFor>[1] = 'pulls') => {
  const { fetchImpl } = recorder();
  return callFor(hostContext(provider, fetchImpl), section, '12', write);
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

describe('callFor — a merge', () => {
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

    const bitbucket = call('bitbucket', { kind: 'merge', method: 'rebase' });
    if ('error' in bitbucket) throw new Error(bitbucket.error);
    expect(bitbucket.body).toEqual({ merge_strategy: 'fast_forward' });
  });
});

describe('callFor — a review', () => {
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
});

describe('callFor — a section that has no write', () => {
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
