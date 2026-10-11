/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The bundled example plugin's SERVER half.
 *
 * It exists to exercise every member of `ChamberPluginApi` in one small file,
 * so a change that breaks one of them is visible without writing a plugin. What
 * each part is FOR is stated where it is used; what matters here is that all of
 * it is disposed: a plugin that registers a method, a route and a topic and
 * then forgets one of them is the failure this example would otherwise teach.
 *
 * The default export is a FACTORY (`export default function plugin(api) {}`),
 * not an object. That is what lets the host hand a plugin the subset of the API
 * it is willing to give, and defer running it until the plugin is loaded.
 */

import type { ChamberPluginApi } from '@ompchamber/plugin-sdk';

/** Notes the server half keeps, one per session, in the plugin's own storage. */
const NOTES_COLLECTION = 'notes';

export default function plugin(api: ChamberPluginApi) {
  api.log.info('session-info server half loaded');

  /**
   * The RPC surface: what the plugin's own client half calls.
   *
   * No input schema on `get` — a session id is the only argument and the handler
   * treats a missing one as "no session" — while `save` validates, because a
   * note that arrives as a number would otherwise be stored as the string
   * `"42"` and read back as text the user never typed.
   */
  api.rpc.register('get', {
    handler: async (sessionId: unknown) => {
      if (typeof sessionId !== 'string' || !sessionId) return null;
      return (await api.storage.records.get(NOTES_COLLECTION, sessionId)) ?? null;
    },
  });

  api.rpc.register<{ sessionId: string; note: string }, { saved: boolean }>('save', {
    input: {
      '~standard': {
        version: 1,
        vendor: 'session-info',
        validate: (value: unknown) => {
          if (typeof value !== 'object' || value === null) {
            return { issues: [{ message: 'expected { sessionId, note }' }] };
          }
          const candidate = value as { sessionId?: unknown; note?: unknown };
          if (typeof candidate.sessionId !== 'string' || !candidate.sessionId) {
            return { issues: [{ message: 'sessionId must be a non-empty string', path: ['sessionId'] }] };
          }
          if (typeof candidate.note !== 'string') {
            return { issues: [{ message: 'note must be a string', path: ['note'] }] };
          }
          return { value: { sessionId: candidate.sessionId, note: candidate.note } };
        },
      },
    },
    handler: async ({ sessionId, note }) => {
      const prefix = (await api.settings.readOne<string>('notePrefix')) ?? '';
      await api.storage.records.put(NOTES_COLLECTION, sessionId, { note: `${prefix}${note}`, savedAt: Date.now() });
      // The plugin's own topic carries the count, so a panel can render it
      // without polling and without a second read of its storage.
      const rows = await api.storage.records.list(NOTES_COLLECTION, { limit: 1000 });
      api.realtime.publish({ noteCount: rows.length });
      return { saved: true };
    },
  });

  /**
   * The HTTP surface: what anything ELSE can call.
   *
   * A plain `Request → Response` handler, which is what a shareable URL or a
   * webhook needs — the shape an RPC method deliberately does not have.
   */
  api.http.route('/notes', async (request) => {
    const rows = await api.storage.records.list(NOTES_COLLECTION, { limit: 100 });
    return Response.json({
      method: request.method,
      count: rows.length,
      ids: rows.map((row) => row.id),
    });
  });

  /**
   * The event surface: the plugin hears its own names, and announces one.
   *
   * The announcement is what a second surface (a future badge, another plugin)
   * subscribes to; it is deliberately not the same channel as the realtime
   * topic, because an event is a MOMENT and a topic is a VALUE.
   */
  api.events.on('note-saved', (payload) => {
    api.log.debug('a note was saved', payload ?? null);
  });

  // The seed, so a subscriber that arrives before the first save gets a value
  // rather than an empty topic.
  api.realtime.seed({ noteCount: 0 });

  /**
   * Background work: one interval that republishes the count.
   *
   * Declared rather than run by the plugin, so the chamber's own scheduler owns
   * the timer and a reload cannot leave a second one behind.
   */
  api.background.schedule('refresh-count', '5m', async () => {
    const rows = await api.storage.records.list(NOTES_COLLECTION, { limit: 1000 });
    api.realtime.publish({ noteCount: rows.length });
  });

  api.onDispose(() => {
    api.log.info('session-info server half disposed');
  });
}
