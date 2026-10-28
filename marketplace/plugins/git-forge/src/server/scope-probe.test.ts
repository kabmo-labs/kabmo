/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The scope probe, and the one rule that makes it honest.
 *
 * A probe that cannot read scopes answers `null`, never `false`: an unreachable
 * endpoint, or a token type the host does not describe, is not evidence that a
 * credential cannot write. Guessing `false` would hide every verb from a reader
 * whose token is fine.
 */

import { describe, expect, test } from 'bun:test';

import { githubScopes, probeWriteScope, scopesAllowWrite } from './scope-probe';
import { hostContext } from './test-context';

describe('scopesAllowWrite', () => {
  test('a write scope is a yes', () => {
    expect(scopesAllowWrite('github', ['repo'])).toBe(true);
    expect(scopesAllowWrite('github', ['read:user', 'public_repo'])).toBe(true);
    expect(scopesAllowWrite('gitlab', ['api'])).toBe(true);
    expect(scopesAllowWrite('gitlab', ['read_api', 'write_repository'])).toBe(true);
  });

  test('read-only scopes are a no', () => {
    expect(scopesAllowWrite('github', ['read:user', 'gist'])).toBe(false);
    expect(scopesAllowWrite('gitlab', ['read_api'])).toBe(false);
  });

  test('an empty list is unknown, not a no', () => {
    expect(scopesAllowWrite('github', [])).toBeNull();
  });

  test('a host with no scope model is unknown', () => {
    expect(scopesAllowWrite('gitea', ['anything'])).toBeNull();
    expect(scopesAllowWrite('bitbucket', ['anything'])).toBeNull();
  });
});

describe('githubScopes', () => {
  test('a comma-separated header is split and trimmed', () => {
    expect(githubScopes('repo, read:user,gist')).toEqual(['repo', 'read:user', 'gist']);
    expect(githubScopes('')).toEqual([]);
    expect(githubScopes(null)).toEqual([]);
  });
});

describe('probeWriteScope', () => {
  test('no credential is a definite no', async () => {
    const { fetchImpl } = fake(() => new Response('{}'));
    expect(await probeWriteScope(hostContext('github', fetchImpl, { token: null }))).toBe(false);
  });

  test('GitHub reports through its header', async () => {
    const { fetchImpl } = fake(
      () => new Response('{}', { status: 200, headers: { 'x-oauth-scopes': 'repo, read:user' } }),
    );
    expect(await probeWriteScope(hostContext('github', fetchImpl))).toBe(true);
  });

  test('a fine-grained token reports no header, which is UNKNOWN rather than no', async () => {
    const { fetchImpl } = fake(() => new Response('{}', { status: 200 }));
    expect(await probeWriteScope(hostContext('github', fetchImpl))).toBeNull();
  });

  test('a failed probe is unknown, never false', async () => {
    const { fetchImpl } = fake(() => new Response('{}', { status: 403 }));
    expect(await probeWriteScope(hostContext('github', fetchImpl))).toBeNull();
  });

  test('GitLab reads its own self endpoint', async () => {
    // The self endpoint's own shape: a top-level `scopes` array.
    const { seen, fetchImpl } = fake(
      () => new Response(JSON.stringify({ id: 1, scopes: ['read_api'] }), { status: 200 }),
    );
    expect(await probeWriteScope(hostContext('gitlab', fetchImpl))).toBe(false);
    expect(seen[0]).toContain('/personal_access_tokens/self');
  });

  test('a host with no scope model answers unknown without a request', async () => {
    const { seen, fetchImpl } = fake(() => new Response('{}'));
    expect(await probeWriteScope(hostContext('gitea', fetchImpl))).toBeNull();
    expect(seen).toHaveLength(0);
  });
});

/** A fetch that answers once and records the URLs it was asked. */
function fake(response: () => Response) {
  const seen: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    seen.push(String(input));
    return response();
  }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}
