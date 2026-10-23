import { bindingsFor, type HandlerBinding } from '@/server/lib/route-adapter';
import * as worktreesList from '@/server/routes/worktrees/list';
import { action as createAction, validateAction } from '@/server/routes/worktrees/create';
import { action as removeAction } from '@/server/routes/worktrees/remove';

/**
 * `/api/worktrees` — list, create, validate, remove.
 *
 * Every binding is explicit rather than `actionBindings`, and that is the whole
 * reason this file exists: `actionBindings` mounts all four mutating verbs AND a
 * 405 GET fallback, and Elysia lets a later registration win — so mounting the
 * create module that way would replace the list loader with a "method not
 * allowed" response on the same path. (`sessions/index.ts` records the same trap
 * for the batch-delete routes.)
 *
 * `validate` is a STATIC segment registered before the collection path.
 * `DELETE` takes the worktree path in its BODY, not in the URL: a path contains
 * separators, and a wildcard segment would also answer for `/validate`.
 */
export const worktreesBindings: HandlerBinding[] = [
  ...bindingsFor(worktreesList, '/api/worktrees'),
  { method: 'POST', path: '/api/worktrees/validate', handler: validateAction },
  { method: 'POST', path: '/api/worktrees', handler: createAction },
  { method: 'DELETE', path: '/api/worktrees', handler: removeAction },
];
