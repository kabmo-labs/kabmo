/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Writing: one mutating request, and the invalidation it owes.
 *
 * Split from `http.ts` because the two answer opposite questions. A READ is
 * conditional and cached — a second read of an unchanged resource costs nothing,
 * which is what makes a forge panel usable at all. A WRITE must never be either:
 * a replayed `304` to a POST would report success for something that did not
 * happen, and a cached answer would hide the state the write produced.
 *
 * The invalidation is scoped to the REPOSITORY rather than to the item, because
 * a write changes two cached URLs at once — the item and the list it came from —
 * and enumerating them per verb drifts the moment a new read is added.
 */

import { describeFailure, isAuthenticated, type JsonCache } from './http';

/** Identifies this client to the host, as every API asks. */
const USER_AGENT = 'kabmo-forge';
const DEFAULT_TIMEOUT_MS = 15_000;


export interface SendOptions {
  url: string;
  method: 'POST' | 'PATCH' | 'PUT';
  body: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export type SendResult = { ok: true; value: unknown; status: number } | { ok: false; status: number; message: string };

/**
 * One mutating request.
 *
 * Deliberately NOT cached, and deliberately not conditional: a write is the one
 * request whose answer must be the host's real one, and a replayed 304 to a POST
 * would report success for something that did not happen.
 *
 * A 204 (GitHub answers one for several verbs) is a success with no body, which
 * is why `value` is null rather than a parse failure.
 */
export async function sendJson(options: SendOptions): Promise<SendResult> {
  const doFetch = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(options.url, {
      method: options.method,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': USER_AGENT,
        ...options.headers,
      },
      body: JSON.stringify(options.body),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, status: 0, message: `Could not reach the host: ${reason}` };
  }

  if (!response.ok) {
    return { ok: false, status: response.status, message: describeFailure(response, isAuthenticated(options.headers)) };
  }

  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return { ok: true, value: null, status: response.status };
  }

  try {
    return { ok: true, value: (await response.json()) as unknown, status: response.status };
  } catch {
    // A 200 whose body is not JSON is still a success for a verb whose answer
    // the panel does not read (a merge reports nothing useful anyway).
    return { ok: true, value: null, status: response.status };
  }
}

/**
 * Drop every cached entry whose URL satisfies `match`.
 *
 * A write invalidates reads it did not touch directly: merging a PR changes the
 * PR's detail AND the list it came from, and the two are different URLs. Rather
 * than enumerate the affected keys per verb — which drifts the moment a new read
 * is added — the invalidation is scoped to the repository's own URLs, which is
 * every entry a write could have changed and nothing outside it.
 */
export async function invalidateWhere(cache: JsonCache, match: (url: string) => boolean): Promise<number> {
  let dropped = 0;
  for (const key of await cache.keys()) {
    const entry = await cache.read(key);
    // An entry with no URL can never match anything, so it is dead weight rather
    // than a survivor: dropping it is what keeps a half-written record from
    // living for the life of the install.
    if (!entry || !entry.url) {
      await cache.remove(key);
      continue;
    }
    if (!match(entry.url)) continue;
    await cache.remove(key);
    dropped += 1;
  }
  return dropped;
}
