/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A plugin's realtime topic.
 *
 * A plugin does not get its own socket or its own frame vocabulary. It
 * publishes a VALUE onto the chamber's existing hub, which already owns the
 * sequence numbering, the snapshot-on-subscribe behaviour, the delta
 * coalescing and the subscriber refcount — so a plugin topic behaves exactly
 * like `sidebar` or `usage`, and the client needs no branch for it.
 *
 * `seed` and `publish` are separate on purpose: the hub resolves a topic on
 * demand when someone subscribes, so a plugin that only ever published would
 * have nothing to answer a subscriber that arrives before its first change,
 * and a plugin that only ever seeded would never notify anyone.
 */

import { getRealtimeHub } from '@/server/lib/realtime/hub.server';
import { pluginTopic } from '@/shared/lib/plugins/protocol';
import type { PluginJson, PluginRealtimeApi } from '@kabmo-labs/plugin-sdk';

/**
 * The last value each plugin topic holds, process-wide.
 *
 * Anchored on `globalThis` for the same reason the database handle is: under
 * `bun --hot` this module re-evaluates while loaded plugins still hold
 * references into the previous copy, and a module-level map would come back
 * empty — a subscriber would then be answered "no value" for a topic that has
 * one.
 */
declare global {
  // eslint-disable-next-line no-var
  var __ompChamberPluginTopicValues: Map<string, PluginJson> | undefined;
}

function topicValues(): Map<string, PluginJson> {
  return (globalThis.__ompChamberPluginTopicValues ??= new Map());
}

/** The API one plugin is handed at load. */
export function createPluginRealtime(pluginId: string): PluginRealtimeApi {
  const topic = pluginTopic(pluginId);
  return {
    current: () => topicValues().get(topic),
    seed(payload) {
      topicValues().set(topic, payload);
    },
    publish(payload) {
      topicValues().set(topic, payload);
      getRealtimeHub().publish(topic, payload);
    },
  };
}

/** The value a topic resolver answers with, for the hub's descriptor. */
export function pluginTopicValue(pluginId: string): PluginJson | undefined {
  return topicValues().get(pluginTopic(pluginId));
}

/** Forget a plugin's topic value — called from its disposal pass. */
export function clearPluginTopic(pluginId: string): void {
  topicValues().delete(pluginTopic(pluginId));
}
