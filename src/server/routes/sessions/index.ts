import { actionBindings, bindingsFor, type HandlerBinding } from '@/server/lib/route-adapter';
import * as sessionsList from '@/server/routes/sessions/list';
import * as sessionsFolder from '@/server/routes/sessions/folder';
import * as sessionsQueue from '@/server/routes/sessions/queue';
import {
  archiveSession,
  getSessionModes,
  getSessionState,
  markSeen,
  putSessionState,
  renameSession,
  renameWithAi,
} from '@/server/routes/sessions/session';
import { listSubagents, readSubagentTranscript } from '@/server/routes/sessions/subagents';
import { cancelSubagent, steerSubagent } from '@/server/routes/sessions/subagent-control';
import { deleteSession } from '@/server/routes/sessions/delete';
import { batchDeleteSessions } from '@/server/routes/sessions/batch-delete';
import { batchArchiveSessions } from '@/server/routes/sessions/batch-archive';

export const sessionsBindings: HandlerBinding[] = [
  ...bindingsFor(sessionsList, '/api/sessions/list'),
  // Registered BEFORE the `:sessionId` routes: the segment is static, and the
  // batch route is POST while `:sessionId` answers DELETE, so an id route
  // winning the match would turn every batch into a 405.
  { method: 'POST', path: '/api/sessions/batch-delete', handler: batchDeleteSessions },
  // The archive batch is static too, and must be registered before the
  // `:sessionId` routes for the same reason as batch-delete.
  { method: 'POST', path: '/api/sessions/batch-archive', handler: batchArchiveSessions },
  ...bindingsFor(sessionsFolder, '/api/sessions/:sessionId'),
  // DELETE-only on the same path the folder loader answers GET on: mounting it
  // through `actionBindings` would register a 405 GET fallback that Elysia
  // applies after the loader, replacing the workspace listing with it.
  { method: 'DELETE', path: '/api/sessions/:sessionId', handler: deleteSession },
  ...actionBindings(archiveSession, '/api/sessions/:sessionId/archive'),
  // Per-item queue routes. `actionBindings` mounts ALL four mutating verbs on
  // one path, and Elysia lets a later registration override an earlier one —
  // mounting reorder on the same `/queue` path that way would clobber the
  // add/GET bindings with its 405 GET fallback. Only reorder gets an explicit
  // PUT-only binding; add carries the shared GET loader.
  ...actionBindings(sessionsQueue.addQueueItem, '/api/sessions/:sessionId/queue', sessionsQueue.getQueue),
  ...actionBindings(sessionsQueue.editQueueItem, '/api/sessions/:sessionId/queue/:itemId'),
  { method: 'PUT', path: '/api/sessions/:sessionId/queue', handler: sessionsQueue.reorderQueueItems },
  { method: 'DELETE', path: '/api/sessions/:sessionId/queue/:itemId', handler: sessionsQueue.removeQueueItem },
  ...actionBindings(sessionsQueue.nudgeQueueDelivery, '/api/sessions/:sessionId/queue/deliver'),
  ...actionBindings(renameSession, '/api/sessions/:sessionId/rename'),
  ...actionBindings(renameWithAi, '/api/sessions/:sessionId/rename-with-ai'),
  ...actionBindings(putSessionState, '/api/sessions/:sessionId/state', getSessionState),
  { method: 'GET', path: '/api/sessions/:sessionId/modes', handler: getSessionModes },
  ...actionBindings(markSeen, '/api/sessions/:sessionId/stream-seen'),
  { method: 'GET', path: '/api/sessions/:sessionId/subagents', handler: listSubagents },
  { method: 'GET', path: '/api/sessions/:sessionId/subagents/:subagentId', handler: readSubagentTranscript },
  // Per-subagent control. POST-only: they act on the session's live child, and
  // a wrong verb must not fall through to the roster loader above.
  { method: 'POST', path: '/api/sessions/:sessionId/subagents/:subagentId/cancel', handler: cancelSubagent },
  { method: 'POST', path: '/api/sessions/:sessionId/subagents/:subagentId/steer', handler: steerSubagent },
];
