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

import type { ForgeProvider } from '../protocol';
import { authHeaders, getJson, type GetResult, type JsonCache } from './http';

export interface ForgeContext {
  provider: ForgeProvider;
  apiBase: string;
  /** `owner/name`, subgroups included. */
  slug: string;
  webUrl: string;
  host: string;
  token: string | null;
  perPage: number;
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

/** Join an API root and a path without doubling or dropping the separator. */
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** The page size a read asks for, clamped to what both hosts accept. */
export function pageSize(context: ForgeContext): number {
  return Math.min(100, Math.max(1, Math.round(context.perPage)));
}
