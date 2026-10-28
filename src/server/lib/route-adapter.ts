import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { maybeCompress } from '@/server/plugins/compress';

/**
 * Serves ported Remix route modules from Elysia.
 *
 * The API modules were written against Remix's `loader`/`action` contract and
 * each one encodes its own method dispatch, status codes, and error envelopes.
 * Rewriting them by hand would put every one of those behaviors at risk, so
 * instead each domain module exports a table of `{ method, path, handler }`
 * bindings and `routes/index.ts` projects them onto one Elysia instance.
 *
 * Bindings are plain data, which sidesteps Elysia's invariant per-prefix
 * instance generics: no module has to thread a parameterized Elysia type
 * around just to contribute routes.
 */

export type RouteModule = {
  loader?: (args: LoaderFunctionArgs) => unknown;
  action?: (args: ActionFunctionArgs) => unknown;
};

export type RouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type RouteHandler = (args: LoaderFunctionArgs | ActionFunctionArgs) => unknown;

export interface HandlerBinding {
  method: RouteMethod;
  path: string;
  handler: RouteHandler;
}

export interface MountOptions {
  mutating?: readonly Exclude<RouteMethod, 'GET'>[];
}

export function bindingsFor(module: RouteModule, path: string, options: MountOptions = {}): HandlerBinding[] {
  const bindings: HandlerBinding[] = [];
  if (module.loader) bindings.push({ method: 'GET', path, handler: module.loader });
  else if (module.action) bindings.push({ method: 'GET', path, handler: methodNotAllowed });
  if (module.action) {
    for (const method of options.mutating ?? (['POST', 'PUT', 'PATCH', 'DELETE'] as const)) {
      bindings.push({ method, path, handler: module.action });
    }
  }
  return bindings;
}

/**
 * Remix answered a GET on an action-only route with 405, not 404 — the route
 * exists, the verb does not. Keeping that shape means a mistyped client call
 * reports the real problem instead of looking like a missing endpoint.
 */
export const methodNotAllowed: RouteHandler = () => methodNotAllowedResponse();

/**
 * The same answer, typed as a `Response`.
 *
 * `RouteHandler` returns `unknown` because a handler may answer anything, and a
 * route that declares `Promise<Response>` cannot return that: the widening is
 * where a 405 would silently become "not a response". One function, so the two
 * spellings cannot word the refusal differently.
 */
export function methodNotAllowedResponse(): Response {
  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** Parse a JSON request body without throwing. Caller decides the status code. */
export async function parseJsonBody<T = unknown>(
  request: Request,
): Promise<{ ok: true; body: T } | { ok: false; error: string }> {
  try {
    return { ok: true, body: (await request.json()) as T };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Extract a required route param; returns null when absent or empty. */
export function requireParam(params: Record<string, string>, name: string): string | null {
  const value = params[name];
  return value ? value : null;
}

/** JSON error envelope with the given status (default 500). */
export function errorResponse(error: unknown, status = 500): Response {
  return json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

async function toResponse(value: unknown): Promise<Response> {
  if (value instanceof Response) return value;
  if (value instanceof ReadableStream) {
    return new Response(value, {
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
    });
  }
  return new Response(JSON.stringify(value ?? null), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export function adaptHandler(handler: RouteHandler) {
  return async ({ request, params }: { request: Request; params: Record<string, string> }) => {
    try {
      const response = await toResponse(await handler({ request, params }));
      return await maybeCompress(response, request.headers.get('accept-encoding'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
  };
}

/** Register binding tables on an Elysia app. Returns the same instance. */
export function mountBindings<T extends {
  get: (path: string, handler: never) => T;
  post: (path: string, handler: never) => T;
  put: (path: string, handler: never) => T;
  patch: (path: string, handler: never) => T;
  delete: (path: string, handler: never) => T;
}>(app: T, bindings: readonly HandlerBinding[]): T {
  let next = app;
  for (const { method, path, handler } of bindings) {
    const adapted = adaptHandler(handler) as never;
    if (method === 'GET') next = next.get(path, adapted);
    else if (method === 'POST') next = next.post(path, adapted);
    else if (method === 'PUT') next = next.put(path, adapted);
    else if (method === 'PATCH') next = next.patch(path, adapted);
    else next = next.delete(path, adapted);
  }
  return next;
}

/**
 * Mutating verbs for a directly-exported action handler. Pass `getHandler` when
 * the same path also serves a GET; otherwise a 405 GET fallback is added so a
 * mistyped verb reports the real problem instead of a missing route.
 */
export function actionBindings(
  handler: RouteHandler,
  path: string,
  getHandler?: RouteHandler,
): HandlerBinding[] {
  return [
    { method: 'GET', path, handler: getHandler ?? methodNotAllowed },
    ...(['POST', 'PUT', 'PATCH', 'DELETE'] as const).map((method) => ({ method, path, handler })),
  ];
}
