/**
 * The `@remix-run/node` surface the API route modules actually used: the
 * `json()` response helper and the two context argument types. Elysia serves
 * these modules now (see `@/server/lib/route-adapter`), so the shim keeps the
 * loader/action bodies — and therefore every status code and payload — intact.
 */
export interface LoaderFunctionArgs {
  request: Request;
  params: Record<string, string>;
}

export interface ActionFunctionArgs {
  request: Request;
  params: Record<string, string>;
}

export interface JsonInit {
  status?: number;
  headers?: Record<string, string>;
}

export function json(data: unknown, init: JsonInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { status: init.status ?? 200, headers });
}

/** Shared no-store response headers for endpoints that must never be cached. */
export const NO_STORE_HEADERS: Record<string, string> = { 'cache-control': 'no-store' };
