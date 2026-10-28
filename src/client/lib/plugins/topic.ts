/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A plugin's own realtime topic, as the CLIENT sees it.
 *
 * `useRealtime` in the kit cannot import this — the kit is a published package —
 * so the host registers these four functions through `configureUiKit` and the
 * hook calls them. They are thin on purpose: the subscription, the value and
 * the staleness all live on Kabmo's existing realtime client, so a plugin
 * topic behaves exactly like `sidebar` or `usage`.
 *
 * Staleness comes from the CLIENT's own per-topic flag, not from the socket's
 * status: a topic whose sequence gap was seen is stale while the socket is
 * perfectly healthy, and reading the socket would report it as current.
 */

import { realtimeClient } from '@/shared/lib/realtime/client';
import { pluginTopic } from '@/shared/lib/plugins/protocol';

/**
 * Subscribe to `plugin:<id>`.
 *
 * A null id subscribes to nothing and answers nothing — a plugin whose bundle
 * is not the one loading has no topic, and inventing one would subscribe to a
 * topic that can never publish.
 */
export function subscribePluginTopic(pluginId: string | null, listener: (value: unknown) => void): () => void {
  if (!pluginId) return () => {};
  const topic = pluginTopic(pluginId);
  // The listener takes no arguments: the client hands a notification, and the
  // value is read back through `readPluginTopic` — which is what keeps ONE
  // source of truth for the current value rather than a copy per subscriber.
  return realtimeClient.subscribe(topic, () => listener(readPluginTopic(pluginId)));
}

/** The plugin's topic value as it stands, or undefined before the first frame. */
export function readPluginTopic(pluginId: string | null): unknown {
  if (!pluginId) return undefined;
  return realtimeClient.read<unknown>(pluginTopic(pluginId)) ?? undefined;
}

/** Ask the server for a fresh snapshot of the plugin's topic. */
export function refreshPluginTopic(pluginId: string | null): void {
  if (!pluginId) return;
  realtimeClient.refresh(pluginTopic(pluginId));
}

/** Whether the value on hand is not known to be current. */
export function pluginTopicStale(pluginId: string | null): boolean {
  if (!pluginId) return true;
  return realtimeClient.isStale(pluginTopic(pluginId));
}
