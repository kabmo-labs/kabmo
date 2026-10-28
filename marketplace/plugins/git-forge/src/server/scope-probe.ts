/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Can this credential WRITE, or only read?
 *
 * The panel asks because a read-only token is a panel full of buttons that can
 * only fail — and the failure arrives as a 403 from an API the reader did not
 * know was involved. Three hosts answer, one does not, and the honest answer is
 * `null` for the one that does not:
 *
 * - **GitHub** reports `x-oauth-scopes` on a REST response for an OAuth token.
 *   A fine-grained PAT reports NOTHING, so absence is `null`, never `false`.
 * - **GitLab** answers `GET /personal_access_tokens/self` with a `scopes` array
 *   — but only for a token that may read itself, which a project token cannot.
 * - **Gitea** has no scope model at all: a token either can write or the host
 *   refuses the verb, so `null`.
 * - **Bitbucket** app passwords carry permissions the API does not echo, so
 *   `null` as well.
 *
 * The probe is one cheap GET, run only when the reader opens the credential
 * sheet — not on every panel mount, because it is a request against the same
 * budget the reads use.
 */

import type { ForgeProvider } from '../protocol';
import { authHeaders } from './http';
import { get, joinUrl, type ForgeContext } from './context';

/**
 * Scope names that grant a write, per host.
 *
 * Exact names where the host publishes an exact list, and a prefix only where it
 * does not: GitHub's classic scopes are a closed set (`repo`, `public_repo`,
 * `gist`, `workflow`, …) while a fine-grained token names resources
 * (`pull_requests:write`). Matching `read:user` against a bare `repo` substring
 * is the trap — it CONTAINS no write scope, and a `includes('repo')` test would
 * say it does.
 */
const WRITE_SCOPES: Record<ForgeProvider, readonly string[]> = {
  github: ['repo', 'public_repo', 'workflow', ':write'],
  gitlab: ['api', 'write_repository', 'write_api'],
  gitea: [],
  bitbucket: [],
};

/**
 * Whether a scope list contains something that can write.
 *
 * `null` means "this host does not say", which is a different answer from "no"
 * and must not be collapsed into it.
 */
export function scopesAllowWrite(provider: ForgeProvider, scopes: readonly string[]): boolean | null {
  if (scopes.length === 0) return null;
  const allowed = WRITE_SCOPES[provider];
  if (allowed.length === 0) return null;
  return scopes.some((scope) => {
    const name = scope.trim().toLowerCase();
    return allowed.some((entry) => {
      // `:write` is a SUFFIX rule, for a fine-grained GitHub token
      // (`pull_requests:write`). Every other entry is an EXACT name: matching
      // `read_api` against `api` by suffix is exactly the false positive that
      // would show every write button to a read-only token.
      if (entry.startsWith(':')) return name.endsWith(entry);
      return name === entry;
    });
  });
}

/** The scopes GitHub reported, from a response's headers. */
export function githubScopes(header: string | null): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);
}

/**
 * Probe the credential's write ability, or `null` when the host does not say.
 *
 * A probe that fails is `null`: an unreachable endpoint is not evidence that a
 * token cannot write, and guessing `false` would hide every verb from a reader
 * whose token is fine.
 */
export async function probeWriteScope(context: ForgeContext): Promise<boolean | null> {
  if (!context.token) return false;

  if (context.provider === 'github') {
    // `/user` is the cheapest authenticated REST call, and it is the one that
    // carries the scope header.
    const result = await getWithHeaders(context, joinUrl(context.apiBase, '/user'));
    if (!result.ok) return null;
    return scopesAllowWrite('github', githubScopes(result.scopes));
  }

  if (context.provider === 'gitlab') {
    const result = await get(context, joinUrl(context.apiBase, '/personal_access_tokens/self'));
    if (!result.ok) return null;
    // `{scopes: ["api"]}` on the self endpoint; a token that may not read itself
    // answers 403, which the `!result.ok` above already turned into `null`.
    const record = typeof result.value === 'object' && result.value !== null ? (result.value as { scopes?: unknown }) : {};
    const scopes = Array.isArray(record.scopes) ? record.scopes.filter((entry): entry is string => typeof entry === 'string') : [];
    return scopesAllowWrite('gitlab', scopes);
  }

  return null;
}

/** One GET that also reports the scope header. */
async function getWithHeaders(
  context: ForgeContext,
  url: string,
): Promise<{ ok: true; scopes: string | null } | { ok: false }> {
  const doFetch = context.fetchImpl ?? fetch;
  try {
    const response = await doFetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'kabmo-forge', ...authHeaders(context.provider, context.token) },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { ok: false };
    return { ok: true, scopes: response.headers.get('x-oauth-scopes') };
  } catch {
    return { ok: false };
  }
}
