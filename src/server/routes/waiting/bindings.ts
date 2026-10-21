import { actionBindings, type HandlerBinding } from '@/server/lib/route-adapter';
import * as waiting from '@/server/routes/waiting/index';

/**
 * `/api/waiting` — the collection (GET/POST) and cancel (DELETE `?id=`).
 *
 * One path, two mutating verbs: cancel names its row in the QUERY, so no `:id`
 * segment shares a position with anything else in the tree.
 */
export const waitingBindings: HandlerBinding[] = actionBindings(
  waiting.action,
  '/api/waiting',
  waiting.loader,
);
