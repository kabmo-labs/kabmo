/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A plugin's realtime topic, as the hub sees it.
 *
 * The resolver answers the value the plugin PUBLISHED, read from the same
 * process-wide map the plugin writes through (`realtime.server.ts`). It does
 * not call into plugin code, and that is deliberate: a resolver runs on every
 * subscribe and every resync, so one that invoked a plugin would run third-party
 * code for a topic nobody may be looking at — and would throw for a plugin that
 * is switched off but still named by a stored layout.
 *
 * A topic with no published value resolves to `null` rather than rejecting. The
 * hub treats a rejected resolve as a broken topic and reports it to the
 * subscriber; "this plugin has not published yet" is a normal state, not an
 * error, and the client renders it as an empty view.
 */

import { pluginTopicValue } from '@/server/lib/plugins/realtime.server';
import type { TopicDescriptor } from '@/server/lib/realtime/hub.types';

/** The descriptor for `plugin:<pluginId>`. */
export function pluginDescriptor(pluginId: string): TopicDescriptor {
  return {
    resolve: async () => pluginTopicValue(pluginId) ?? null,
  };
}
