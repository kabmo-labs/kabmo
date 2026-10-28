/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One JSON read, with the cache that makes browsing cheap.
 *
 * Every request this plugin makes is CONDITIONAL, and that is not an
 * optimisation — it is what makes a forge panel usable at all. GitHub's own
 * documentation is explicit: a conditional request that answers `304` does not
 * count against the primary rate limit *when it is authenticated*. So the panel
 * can re-read on every mount and every Refresh and cost nothing while nothing
 * changed, which is the common case for an issue list.
 *
 * Three rules follow from that:
 *
 * - **The cache stores the NORMALIZED payload, not the API body.** What a later
 *   `304` returns must be what the panel renders, and the adapters are the only
 *   code that knows how to turn a body into one. Caching the raw body would mean
 *   re-mapping on every hit, and caching nothing would mean a second round trip.
 * - **A failure is a sentence, not a status code.** 401/403/404/429 each mean a
 *   different thing to the reader, and "HTTP 403" is the least useful way to say
 *   "your token cannot see this".
 * - **The cache is bounded and self-pruning.** A key/value store with one entry
 *   per URL would grow for as long as a workspace is used; the oldest entries go
 *   when the count passes a ceiling, and anything a week old goes with them.
 */

import type { PluginJson } from '@kabmo-labs/kabmo-sdk';
import type { ForgeProvider } from '../protocol';

/** One cached answer, keyed by its URL. */
export interface CachedResponse {
  url: string;
  etag: string | null;
  lastModified: string | null;
  /** The mapped payload the panel renders. */
  value: PluginJson;
  /** When it was written, for pruning. */
  at: number;
}

/** The slice of the plugin's storage this module needs. */
export interface JsonCache {
  read(key: string): Promise<CachedResponse | undefined>;
  write(key: string, entry: CachedResponse): Promise<void>;
  keys(): Promise<string[]>;
  remove(key: string): Promise<void>;
}

export type GetResult =
  | { ok: true; value: unknown; cached: boolean }
  | { ok: false; status: number; message: string };

export interface GetOptions {
  cache: JsonCache;
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Injected by the tests; the host always uses the platform's own `fetch`. */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** Identifies this client to the host, as every API asks. */
const USER_AGENT = 'kabmo-forge';

const DEFAULT_TIMEOUT_MS = 15_000;

/** Entries kept before the oldest are dropped. */
const MAX_ENTRIES = 60;

/** Entries older than this are dropped on the next prune. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** A stable short key: FNV-1a, because the store's keys are strings. */
export function cacheKey(url: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < url.length; index += 1) {
    hash ^= url.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `cache:${hash.toString(16).padStart(8, '0')}:${url.length.toString(16)}`;
}

/**
 * The credential header each host takes.
 *
 * Four spellings, and getting one wrong is a 401 that reads as a bad token:
 * GitHub wants `Authorization: Bearer` (plus the API version pin, without which
 * the response shape follows the account's default), GitLab wants its own
 * `PRIVATE-TOKEN`, Gitea accepts `Authorization: token`, and Bitbucket's access
 * tokens are Bearer while its APP PASSWORDS are Basic — which is why a token
 * containing a colon is base64-encoded as a user/password pair rather than sent
 * as a Bearer value the host will reject.
 */
export function authHeaders(provider: ForgeProvider, token: string | null): Record<string, string> {
  if (!token) return {};
  if (provider === 'github') return { authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28' };
  if (provider === 'gitlab') return { 'private-token': token };
  if (provider === 'gitea') return { authorization: `token ${token}` };
  // Bitbucket: `user:app-password` is an app password, anything else is an
  // access token.
  return token.includes(':')
    ? { authorization: `Basic ${Buffer.from(token, 'utf8').toString('base64')}` }
    : { authorization: `Bearer ${token}` };
}

/** Whether a credential is present, from the headers it produced. */
export function isAuthenticated(headers: Record<string, string> | undefined): boolean {
  if (!headers) return false;
  return Boolean(headers.authorization || headers['private-token']);
}

/**
 * What a failed status means to the person reading the panel.
 *
 * `authenticated` is a parameter because the same status means two different
 * things. A 403 from a request that carried no credential is the host refusing
 * an ANONYMOUS read — measured on a public GitLab project, where two of three
 * sections answered 403 and the third answered 200 — and telling that reader
 * their token lacks scope is advice about a token that does not exist.
 */
export function describeFailure(response: Response, authenticated: boolean): string {
  const status = response.status;
  if (status === 401) {
    // Anonymous is a different problem from a bad token, and the advice differs:
    // GitLab answers 401 on the notes endpoint to a reader with NO credential
    // (measured on a public project), where "check your token" is advice about a
    // token that was never sent.
    return authenticated
      ? 'The host rejected the credential (401). Check the token in GITHUB_TOKEN / GH_TOKEN / GITLAB_TOKEN, or the one `gh` / `glab` has stored.'
      : 'This endpoint needs a token (401) even on a public repository. Set GITHUB_TOKEN / GITLAB_TOKEN / GITEA_TOKEN in the server environment, or run `gh` / `glab` auth login.';
  }
  if (status === 403) {
    const remaining = response.headers.get('x-ratelimit-remaining');
    if (remaining === '0') return `Rate limit reached (403). ${resetHint(response.headers.get('x-ratelimit-reset'))}`;
    if (!authenticated) {
      return 'The host refused an anonymous read (403). Some hosts and projects require a token even to list; set GITHUB_TOKEN / GITLAB_TOKEN, or run `gh` / `glab` auth login.';
    }
    return 'Access refused (403). The token may not have scope for this repository.';
  }
  if (status === 404) {
    return authenticated
      ? 'Not found (404). The repository may be renamed, or the token may not see it.'
      : 'Not found (404). The repository may be private or renamed; a private one needs a token.';
  }
  if (status === 429) {
    return `Rate limited (429). ${resetHint(response.headers.get('retry-after'))}`;
  }
  return `The host answered ${status}.`;
}

/** "Try again after HH:MM", from a unix-seconds reset or a seconds delay. */
function resetHint(value: string | null): string {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Try again later.';
  // `x-ratelimit-reset` is an absolute unix timestamp; `retry-after` is a delay.
  const at = seconds > 1_000_000_000 ? new Date(seconds * 1000) : new Date(Date.now() + seconds * 1000);
  return `Try again after ${at.toLocaleTimeString()}.`;
}

/**
 * Read one URL as JSON, using and updating the cache.
 *
 * The conditional headers are sent only when there is something to compare
 * against, and only one of them: a host that answers `304` to an `If-None-Match`
 * it did not mint would otherwise hide a changed body behind a stale date.
 */
export async function getJson(options: GetOptions): Promise<GetResult> {
  const key = cacheKey(options.url);
  const now = options.now ?? Date.now;
  const entry = await options.cache.read(key);

  const headers: Record<string, string> = {
    accept: 'application/json',
    'user-agent': USER_AGENT,
    ...options.headers,
  };
  if (entry?.etag) headers['if-none-match'] = entry.etag;
  else if (entry?.lastModified) headers['if-modified-since'] = entry.lastModified;

  const doFetch = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(options.url, {
      headers,
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, status: 0, message: `Could not reach the host: ${reason}` };
  }

  if (response.status === 304) {
    // A 304 with nothing cached is a host bug; asking again without the header
    // is the only answer that can produce a body.
    if (entry) return { ok: true, value: entry.value, cached: true };
    return { ok: false, status: 304, message: 'The host answered 304 to a request that carried no cache entry.' };
  }

  if (!response.ok) {
    return { ok: false, status: response.status, message: describeFailure(response, isAuthenticated(options.headers)) };
  }

  let value: PluginJson;
  try {
    value = (await response.json()) as PluginJson;
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, status: response.status, message: `The host sent a body that is not JSON: ${reason}` };
  }

  const fresh: CachedResponse = {
    url: options.url,
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified'),
    value,
    at: now(),
  };
  await options.cache.write(key, fresh);
  await prune(options.cache, now());
  return { ok: true, value, cached: false };
}

/**
 * Read one URL as TEXT.
 *
 * Two hosts answer a diff as `text/plain` — Gitea's `.diff` route and
 * Bitbucket's `/diff` — and `getJson` cannot read either: `response.json()`
 * throws on `@@ -1 +1 @@`, so the whole file list came back empty with a note
 * about a body that "is not JSON". The cache is shared, because a diff is a
 * resource like any other and its validator works the same way.
 */
export async function getText(options: GetOptions): Promise<GetResult> {
  const key = cacheKey(options.url);
  const now = options.now ?? Date.now;
  const entry = await options.cache.read(key);

  const headers: Record<string, string> = {
    accept: 'text/plain',
    'user-agent': USER_AGENT,
    ...options.headers,
  };
  if (entry?.etag) headers['if-none-match'] = entry.etag;
  else if (entry?.lastModified) headers['if-modified-since'] = entry.lastModified;

  const doFetch = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(options.url, {
      headers,
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, status: 0, message: `Could not reach the host: ${reason}` };
  }

  if (response.status === 304 && entry) return { ok: true, value: entry.value, cached: true };
  if (!response.ok) {
    return { ok: false, status: response.status, message: describeFailure(response, isAuthenticated(options.headers)) };
  }

  let value: string;
  try {
    value = await response.text();
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, status: response.status, message: `The host's body could not be read: ${reason}` };
  }

  await options.cache.write(key, {
    url: options.url,
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified'),
    value,
    at: now(),
  });
  return { ok: true, value, cached: false };
}

/**
 * Keep the cache bounded.
 *
 * Runs after a write and only when the ceiling is crossed, so the ordinary read
 * costs one `keys()` at most. Entries are dropped oldest-first down to a
 * watermark well below the ceiling, which is what makes the pass amortised
 * rather than a full sort on every request.
 */
async function prune(cache: JsonCache, now: number): Promise<void> {
  const keys = await cache.keys();
  if (keys.length <= MAX_ENTRIES) {
    // Under the ceiling, but an expired entry is still worth dropping: a
    // week-old ETag is a re-read that answers 200 anyway.
    for (const key of keys) {
      const entry = await cache.read(key);
      if (entry && now - entry.at > MAX_AGE_MS) await cache.remove(key);
    }
    return;
  }

  const entries: Array<{ key: string; at: number }> = [];
  for (const key of keys) {
    const entry = await cache.read(key);
    if (entry) entries.push({ key, at: entry.at });
    else await cache.remove(key);
  }
  entries.sort((left, right) => left.at - right.at);
  const keep = Math.floor(MAX_ENTRIES / 2);
  const doomed = entries.slice(0, Math.max(0, entries.length - keep));
  for (const entry of doomed) await cache.remove(entry.key);
}

/** The cache adapter over the plugin's own key/value store. */
export function kvCache(kv: {
  read<T>(key: string): Promise<T | undefined>;
  write(key: string, value: PluginJson): Promise<void>;
  keys(): Promise<string[]>;
  remove(key: string): Promise<void>;
}): JsonCache {
  return {
    read: (key) => kv.read<CachedResponse>(key),
    write: (key, entry) => kv.write(key, entry as unknown as PluginJson),
    keys: () => kv.keys(),
    remove: (key) => kv.remove(key),
  };
}
