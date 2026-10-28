/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One read, as both adapters perform it.
 *
 * The context exists so an adapter is a pure transcription: it is handed a way to
 * GET a URL and answers protocol shapes. That is what makes the mapping testable
 * against a recorded body with no host, no token and no socket — and it is why
 * neither adapter owns the cache, the credential or the timeout.
 */

import type { ForgeFilter, ForgeProvider } from '../protocol';
import { authHeaders, getJson, getText, type GetResult, type JsonCache } from './http';

export interface ForgeContext {
  provider: ForgeProvider;
  apiBase: string;
  /** `owner/name`, subgroups included. */
  slug: string;
  webUrl: string;
  host: string;
  token: string | null;
  perPage: number;
  /** What the read is narrowed to. Every adapter translates it to its own grammar. */
  filter: ForgeFilter;
  cache: JsonCache;
  /** Injected by the tests; production reads the platform's own `fetch`. */
  fetchImpl?: typeof fetch;
}

/** One JSON read, with this context's credential and cache. */
export async function get(context: ForgeContext, url: string): Promise<GetResult> {
  return getJson({
    cache: context.cache,
    url,
    headers: authHeaders(context.provider, context.token),
    ...(context.fetchImpl ? { fetchImpl: context.fetchImpl } : {}),
  });
}

/**
 * One TEXT read, for the hosts that answer a diff as `text/plain`.
 *
 * Re-exported here rather than imported from `http.ts` at each call site, so an
 * adapter has one module to reach for and cannot pick the JSON reader by habit —
 * which is exactly how a diff came back empty with a note about JSON.
 */
export async function getTextWith(context: ForgeContext, url: string): Promise<GetResult> {
  return getText({
    cache: context.cache,
    url,
    headers: authHeaders(context.provider, context.token),
    ...(context.fetchImpl ? { fetchImpl: context.fetchImpl } : {}),
  });
}

/** Join an API root and a path without doubling or dropping the separator. */
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** The page size a read asks for, clamped to what every host accepts. */
export function pageSize(context: ForgeContext): number {
  return Math.min(100, Math.max(1, Math.round(context.perPage)));
}

/** Join a query string onto a URL, keeping the path's own query intact. */
export function withParams(url: string, params: Record<string, string>): string {
  const pairs = Object.entries(params).filter(([, value]) => value !== '');
  if (pairs.length === 0) return url;
  const search = new URLSearchParams(pairs).toString();
  return `${url}${url.includes('?') ? '&' : '?'}${search}`;
}
