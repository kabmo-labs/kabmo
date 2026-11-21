/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Reading JSON without spending the reader's quota twice.
 *
 * A second read of an unchanged resource is a `304`, and GitHub does not charge
 * a conditional request that answers `304` against the primary limit — measured
 * on this repository: six consecutive conditional reads left
 * `x-ratelimit-remaining` untouched. That is why every list, run and jobs read
 * is conditional, so the ETag is stored with the body rather than derived from it.
 *
 * A failure is a SENTENCE, not a status code: "rate limited, try after 14:20" and
 * "this endpoint needs a token even on a public repository" are different things
 * to do next, and the panel renders whichever it got.
 */

import type { PluginJson } from '@kabmo-labs/kabmo-sdk';

/** One cached read: the body, the validator that describes it, and its age. */
export interface CacheEntry {
  url: string;
  etag: string | null;
  body: PluginJson;
  at: number;
}

/** The storage a read needs. Injected so the tests never touch a plugin store. */
export interface JsonCache {
  read(url: string): Promise<CacheEntry | undefined>;
  write(entry: CacheEntry): Promise<void>;
  /** Drop every entry whose URL starts with `prefix` — what a write invalidates. */
  invalidate(prefix: string): Promise<void>;
}

/** The slice of `api.storage.kv` this module uses. */
export interface KvLike {
  read<T = PluginJson>(key: string): Promise<T | undefined>;
  write(key: string, value: PluginJson): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/** Entries kept before the oldest are dropped. */
const MAX_ENTRIES = 40;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 15_000;
const USER_AGENT = 'kabmo-actions';

/** A stable short key: FNV-1a, because the store's keys are strings. */
export function cacheKey(url: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < url.length; index += 1) {
    hash ^= url.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `cache:${hash.toString(16).padStart(8, '0')}:${url.length.toString(16)}`;
}

/** A cache over the plugin's own key/value store. */
export function kvCache(kv: KvLike): JsonCache {
  return {
    async read(url) {
      const entry = await kv.read<CacheEntry>(cacheKey(url));
      return entry && entry.url === url ? entry : undefined;
    },
    async write(entry) {
      await kv.write(cacheKey(entry.url), entry as unknown as PluginJson);
      const keys = await kv.keys();
      const cacheKeys = keys.filter((key) => key.startsWith('cache:'));
      if (cacheKeys.length <= MAX_ENTRIES) return;
      // Prune the oldest: an ETag that never expires would pin a stale body and
      // a store that never shrinks would grow with every filter the user types.
      const entries: Array<{ key: string; at: number }> = [];
      for (const key of cacheKeys) {
        const stored = await kv.read<CacheEntry>(key);
        if (stored) entries.push({ key, at: stored.at });
      }
      entries.sort((a, b) => a.at - b.at);
      for (const stale of entries.slice(0, Math.max(0, entries.length - MAX_ENTRIES))) {
        await kv.remove(stale.key);
      }
    },
    async invalidate(prefix) {
      for (const key of await kv.keys()) {
        if (!key.startsWith('cache:')) continue;
        const stored = await kv.read<CacheEntry>(key);
        if (stored && stored.url.startsWith(prefix)) await kv.remove(key);
      }
    },
  };
}

/** The headers a token adds. Absent means an anonymous read. */
export function authHeaders(token: string | null): Record<string, string> {
  if (!token) return {};
  return { authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28' };
}

/** Whether a request carries a credential. */
export function isAuthenticated(headers: Record<string, string> | undefined): boolean {
  return Boolean(headers?.authorization);
}

/** "Try again after HH:MM", from a unix reset or a seconds delay. */
function resetHint(value: string | null): string {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Try again later.';
  const at = seconds > 1_000_000_000 ? new Date(seconds * 1000) : new Date(Date.now() + seconds * 1000);
  return `Try again after ${at.toLocaleTimeString()}.`;
}

/**
 * What a failed status means to the person reading the panel.
 *
 * `authenticated` matters because the same status means two things: a `403`
 * without a credential is the host refusing an anonymous read, and advising about
 * a token's scope there is advice about a token that was never sent.
 */
export function describeFailure(status: number, headers: Headers, authenticated: boolean): string {
  if (status === 401) {
    return authenticated
      ? 'GitHub rejected the token (401). Check the plugin setting, GITHUB_TOKEN / GH_TOKEN, or `gh auth login`.'
      : 'This endpoint needs a token (401) even on a public repository.';
  }
  if (status === 403) {
    if (headers.get('x-ratelimit-remaining') === '0') {
      return `Rate limit reached (403). ${resetHint(headers.get('x-ratelimit-reset'))}`;
    }
    return authenticated
      ? 'Access refused (403). The token may lack the `repo` / `workflow` scope for this repository.'
      : 'GitHub refused an anonymous read (403). Set a token, or run `gh auth login`.';
  }
  if (status === 404) {
    return authenticated
      ? 'Not found (404). The repository may have been renamed, or the token cannot see it.'
      : 'Not found (404). The repository may be private; a private one needs a token.';
  }
  if (status === 429) return `Rate limited (429). ${resetHint(headers.get('retry-after'))}`;
  return `GitHub answered ${status}.`;
}

export interface GetOptions {
  url: string;
  headers?: Record<string, string>;
  cache: JsonCache;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

export type GetResult =
  | { ok: true; value: PluginJson | undefined; notModified: boolean }
  | { ok: false; status: number; message: string };

/** Read one URL as JSON, conditionally. */
export async function getJson(options: GetOptions): Promise<GetResult> {
  const now = options.now ?? Date.now;
  const entry = await options.cache.read(options.url);
  if (entry && now() - entry.at > MAX_AGE_MS) await options.cache.invalidate(options.url);

  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': USER_AGENT,
    ...options.headers,
  };
  const usable = entry && now() - entry.at <= MAX_AGE_MS ? entry : undefined;
  if (usable?.etag) headers['if-none-match'] = usable.etag;

  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(options.url, {
      headers,
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, status: 0, message: `Could not reach GitHub: ${message}` };
  }

  if (response.status === 304) {
    return { ok: true, value: usable?.body, notModified: true };
  }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      message: describeFailure(response.status, response.headers, isAuthenticated(options.headers)),
    };
  }
  let body: PluginJson;
  try {
    body = (await response.json()) as PluginJson;
  } catch {
    return { ok: false, status: response.status, message: 'GitHub answered a body that is not JSON.' };
  }
  await options.cache.write({ url: options.url, etag: response.headers.get('etag'), body, at: now() });
  return { ok: true, value: body, notModified: false };
}
