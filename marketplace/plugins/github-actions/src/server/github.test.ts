/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The adapter, over recorded bodies.
 *
 * A live host cannot be part of a test: it needs a credential, a network and a
 * repository that does not change. What CAN be wrong is the mapping and the two
 * requests a log costs, so both are driven through an injected `fetch`.
 *
 * The log cases are the load-bearing ones. GitHub answers the log endpoint with
 * `302` to a signed blob URL, and that URL rejects the GitHub token
 * (`401 InvalidAuthenticationInfo`, measured) — so the first request must not
 * follow the redirect and the second must carry NO headers.
 */

import { describe, expect, test } from 'bun:test';

import type { CacheEntry, JsonCache } from './http';
import { act, getRun, jobLog, listJobs, listRuns, type GithubContext } from './github';

function memoryCache(): JsonCache {
  const store = new Map<string, CacheEntry>();
  return {
    read: async (url) => store.get(url),
    write: async (entry) => {
      store.set(entry.url, entry);
    },
    invalidate: async (prefix) => {
      for (const url of [...store.keys()]) if (url.startsWith(prefix)) store.delete(url);
    },
  };
}

function context(overrides: Partial<GithubContext> = {}): GithubContext {
  return {
    apiBase: 'https://api.github.com',
    slug: 'kabmo-labs/kabmo',
    host: 'github.com',
    token: 'tkn',
    perPage: 30,
    cache: memoryCache(),
    ...overrides,
  };
}

const RUN = {
  id: 44733846020,
  name: 'Release',
  display_title: 'feat(chat): made the chat column width draggable',
  head_branch: 'main',
  event: 'push',
  status: 'completed',
  conclusion: 'failure',
  run_number: 185,
  run_attempt: 1,
  actor: { login: 'rajebdev' },
  created_at: '2026-11-20T12:12:28Z',
  run_started_at: '2026-11-20T12:12:28Z',
  updated_at: '2026-11-20T12:19:35Z',
  html_url: 'https://github.com/kabmo-labs/kabmo/actions/runs/44733846020',
};

const JOB = {
  id: 136280140782,
  name: 'E2E specs / Chromium (2/4)',
  status: 'completed',
  conclusion: 'failure',
  started_at: '2026-11-20T12:12:32Z',
  completed_at: '2026-11-20T12:19:34Z',
  runner_name: 'GitHub Actions 1000003380',
  labels: ['ubuntu-latest'],
  html_url: 'https://github.com/kabmo-labs/kabmo/actions/runs/44733846020/job/136280140782',
  steps: [
    { number: 1, name: 'Set up job', status: 'completed', conclusion: 'success' },
    { number: 2, name: 'Run bun run test:e2e', status: 'completed', conclusion: 'failure' },
  ],
};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('listRuns', () => {
  test('maps the rows and says the read was anonymous', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ total_count: 591, workflow_runs: [RUN] })) as unknown as typeof fetch;
    const result = await listRuns(context({ token: null, fetchImpl }), { branch: '', status: '' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.total).toBe(591);
    expect(result.authenticated).toBe(false);
    expect(result.notes.join(' ')).toContain('anonymously');
    expect(result.runs[0]).toMatchObject({
      id: 44733846020,
      name: 'Release',
      branch: 'main',
      state: 'failure',
      number: 185,
      attempt: 1,
      actor: 'rajebdev',
    });
  });

  test('a full page is reported as truncated, not as the whole list', async () => {
    const runs = Array.from({ length: 30 }, (_, index) => ({ ...RUN, id: index + 1 }));
    const fetchImpl = (async () =>
      jsonResponse({ total_count: 591, workflow_runs: runs })) as unknown as typeof fetch;
    const result = await listRuns(context({ fetchImpl }), { branch: '', status: '' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.truncated).toBe(true);
    expect(result.notes.join(' ')).toContain('GitHub has more');
  });

  test('the filter reaches the query string', async () => {
    let seen = '';
    const fetchImpl = (async (url: string) => {
      seen = url;
      return jsonResponse({ total_count: 0, workflow_runs: [] });
    }) as unknown as typeof fetch;
    await listRuns(context({ fetchImpl }), { branch: 'main', status: 'failure' });
    expect(seen).toContain('branch=main');
    expect(seen).toContain('status=failure');
    expect(seen).toContain('per_page=30');
  });

  test('a refusal carries the sentence, not a bare status', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ message: 'API rate limit exceeded' }, 403, {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': '1795181467',
      })) as unknown as typeof fetch;
    const result = await listRuns(context({ fetchImpl }), { branch: '', status: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('Rate limit reached');
  });
});

describe('getRun / listJobs', () => {
  test('a job carries its steps and their states', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ total_count: 1, jobs: [JOB] })) as unknown as typeof fetch;
    const result = await listJobs(context({ fetchImpl }), RUN.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.jobs[0]?.steps.map((step) => step.state)).toEqual(['success', 'failure']);
    expect(result.jobs[0]?.state).toBe('failure');
  });

  test('a run that cannot be read is a sentence', async () => {
    const fetchImpl = (async () => jsonResponse({ message: 'Not Found' }, 404)) as unknown as typeof fetch;
    const result = await getRun(context({ fetchImpl }), 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('404');
  });
});

describe('jobLog', () => {
  const LOG = '\uFEFF2026-11-20T12:12:32.9658834Z \u001b[31mfirst\u001b[0m\n2026-11-20T12:12:33Z second\n';

  test('the redirect is followed manually, and the blob is fetched without the token', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (calls.length === 1) {
        return new Response(null, { status: 302, headers: { location: 'https://blob.example/log' } });
      }
      return new Response(LOG, { status: 200 });
    }) as unknown as typeof fetch;

    const result = await jobLog(context({ fetchImpl }), 42, 4096);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.log.text).toBe('first\nsecond');
    expect(calls[0]!.url).toContain('/actions/jobs/42/logs');
    expect(calls[0]!.init?.redirect).toBe('manual');
    expect((calls[0]!.init?.headers as Record<string, string>).authorization).toBe('Bearer tkn');
    expect(calls[1]!.url).toBe('https://blob.example/log');
    expect(calls[1]!.init).toBeUndefined();
  });

  test('without a token the refusal names the token instead of calling GitHub', async () => {
    let called = 0;
    const fetchImpl = (async () => {
      called += 1;
      return new Response('', { status: 200 });
    }) as unknown as typeof fetch;
    const result = await jobLog(context({ token: null, fetchImpl }), 42, 4096);
    expect(called).toBe(0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('token');
  });

  test('the tail is cut from the end and says it was truncated', async () => {
    const fetchImpl = (async (url: string) =>
      url.includes('blob.example')
        ? new Response(LOG, { status: 200 })
        : new Response(null, { status: 302, headers: { location: 'https://blob.example/log' } })) as unknown as typeof fetch;
    const result = await jobLog(context({ fetchImpl }), 42, 6);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.log.truncated).toBe(true);
    expect(result.log.text.endsWith('second')).toBe(true);
  });

  test('a 403 from the API surfaces GitHub’s own message', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ message: 'Must have admin rights to Repository.' }, 403)) as unknown as typeof fetch;
    const result = await jobLog(context({ fetchImpl }), 42, 4096);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('Must have admin rights');
  });
});

describe('act', () => {
  test('cancel posts to the cancel path and reports the acceptance', async () => {
    let seen = '';
    let method = '';
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen = url;
      method = init?.method ?? '';
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;
    const result = await act(context({ fetchImpl }), 7, 'cancel');
    expect(seen).toContain('/actions/runs/7/cancel');
    expect(method).toBe('POST');
    expect(result.ok).toBe(true);
  });

  test('a 409 is GitHub’s sentence about a run that already finished', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ message: 'Cannot cancel a workflow run that is completed.' }, 409)) as unknown as typeof fetch;
    const result = await act(context({ fetchImpl }), 7, 'cancel');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('Cannot cancel');
  });

  test('re-run failed jobs uses its own endpoint, not the whole-run one', async () => {
    let seen = '';
    const fetchImpl = (async (url: string) => {
      seen = url;
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    await act(context({ fetchImpl }), 7, 'rerun-failed');
    expect(seen.endsWith('/actions/runs/7/rerun-failed-jobs')).toBe(true);
  });

  test('without a token the verb is refused before the wire', async () => {
    let called = 0;
    const fetchImpl = (async () => {
      called += 1;
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    const result = await act(context({ token: null, fetchImpl }), 7, 'rerun');
    expect(called).toBe(0);
    expect(result.ok).toBe(false);
  });
});
