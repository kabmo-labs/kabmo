/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which topics this hub serves, and how each resolves.
 *
 * Split from `topics.server.ts` because that module is the LIFECYCLE (register
 * once, subscribe to signals, coalesce a burst of republishes) while this one
 * is the CATALOG — a table of families and the lookup that reads it. Adding a
 * topic is a row here; nothing in the lifecycle changes.
 *
 * Every resolver is read-only by contract: subscribing must never spawn an omp
 * child for a session nobody is driving.
 */

import {
  TOPIC_MODELS,
  TOPIC_PANELS,
  TOPIC_SCHEDULE,
  TOPIC_SIDEBAR,
  TOPIC_SIDEBAR_ACTIVITY,
  TOPIC_SIDEBAR_STATUS,
  TOPIC_USAGE,
  TOPIC_WAITING,
  sessionPlanTopic,
  sessionQueueTopic,
  sessionTelemetryTopic,
  sessionTodosTopic,
} from '@/shared/lib/realtime/protocol';
import type { SidebarActivityPayload, SidebarPayload, SidebarStatusPayload } from '@/shared/types/realtime';
import { isValidPluginId } from '@/shared/lib/plugins/protocol';
import type { TopicDescriptor } from '@/server/lib/realtime/hub.types';
import { loadSidebarStatus, loadSidebarStructure } from '@/server/lib/omp/session/sidebar-data.server';
import { loadSidebarActivity } from '@/server/lib/omp/session/sidebar-activity.server';
import { sessionDescriptor } from '@/server/lib/realtime/topics/session.server';
import { btwDescriptor } from '@/server/lib/realtime/topics/btw.server';
import { SESSION_DATA_TOPICS } from '@/server/lib/realtime/topics/session-data.server';
import { globalDescriptor } from '@/server/lib/realtime/topics/global.server';
import { workspaceDescriptor } from '@/server/lib/realtime/topics/workspace.server';
import { pluginDescriptor } from '@/server/lib/realtime/topics/plugin.server';

/**
 * The scoped families, keyed by their topic PREFIX (without the separator).
 *
 * A table rather than a chain of `startsWith` calls: each family's descriptor
 * lives in its own file, and adding one is a row here rather than another
 * branch. A family whose descriptor is missing means the prefix is not served.
 */
export const SCOPED_FAMILIES: Record<string, (scope: string) => TopicDescriptor> = {
  session: sessionDescriptor,
  btw: btwDescriptor,
  git: workspaceDescriptor('git'),
  fs: workspaceDescriptor('fs'),
  repos: workspaceDescriptor('repos'),
  wiki: workspaceDescriptor('wiki'),
  // A plugin's own topic. The resolver reads the value the plugin PUBLISHED
  // rather than asking the plugin for it: a resolver that called into plugin
  // code would run it on every subscribe, including for a plugin that is
  // switched off but still named by a stale stored layout.
  plugin: pluginDescriptor,
};

/** The exact-name topics, plus the per-session DATA families keyed by suffix. */
export const EXACT_TOPICS = new Map<string, TopicDescriptor>([
  [TOPIC_SIDEBAR, { resolve: async (): Promise<SidebarPayload> => loadSidebarStructure() }],
  [TOPIC_SIDEBAR_STATUS, { resolve: async (): Promise<SidebarStatusPayload> => loadSidebarStatus() }],
  [TOPIC_SIDEBAR_ACTIVITY, { resolve: async (): Promise<SidebarActivityPayload> => loadSidebarActivity() }],
  [TOPIC_SCHEDULE, { resolve: () => globalDescriptor(TOPIC_SCHEDULE).resolve(TOPIC_SCHEDULE) }],
  [TOPIC_USAGE, { resolve: () => globalDescriptor(TOPIC_USAGE).resolve(TOPIC_USAGE) }],
  [TOPIC_PANELS, { resolve: () => globalDescriptor(TOPIC_PANELS).resolve(TOPIC_PANELS) }],
  [TOPIC_MODELS, { resolve: () => globalDescriptor(TOPIC_MODELS).resolve(TOPIC_MODELS) }],
  [TOPIC_WAITING, { resolve: () => globalDescriptor(TOPIC_WAITING).resolve(TOPIC_WAITING) }],
]);

/** Suffixes a `session:<id>:<suffix>` topic may carry. */
export const SESSION_DATA_SUFFIXES = new Map<string, (sessionId: string) => TopicDescriptor>([
  ['todos', (id) => SESSION_DATA_TOPICS[sessionTodosTopic('')](id)],
  ['plan', (id) => SESSION_DATA_TOPICS[sessionPlanTopic('')](id)],
  ['telemetry', (id) => SESSION_DATA_TOPICS[sessionTelemetryTopic('')](id)],
  ['queue', (id) => SESSION_DATA_TOPICS[sessionQueueTopic('')](id)],
]);

/**
 * Whether `topic` is one this hub serves.
 *
 * Prefixes are structural: a scoped topic must be asked about for a scope whose
 * snapshot a resolver can produce, and an unknown prefix is refused so a typo
 * reports itself rather than subscribing to nothing.
 */
export function isKnownTopicName(topic: string): boolean {
  if (EXACT_TOPICS.has(topic)) return true;
  const separator = topic.indexOf(':');
  if (separator === -1) return false;
  const family = topic.slice(0, separator);
  const scope = topic.slice(separator + 1);
  if (!scope) return false;
  if (family === 'session') {
    // A session topic is either the session itself or one of its data families.
    const nested = scope.indexOf(':');
    return nested === -1 || SESSION_DATA_SUFFIXES.has(scope.slice(nested + 1));
  }
  // A plugin topic's scope is a plugin ID, and it is validated rather than
  // accepted on the prefix alone: any string after `plugin:` would otherwise be
  // a servable topic, so a typo (or a hand-typed frame) would subscribe to
  // something that can never publish instead of being refused.
  if (family === 'plugin') return isValidPluginId(scope);
  return family in SCOPED_FAMILIES;
}

/** The descriptor for `topic`, building a scoped one on first use. */
export function descriptorFor(topic: string): TopicDescriptor | undefined {
  const exact = EXACT_TOPICS.get(topic);
  if (exact) return exact;
  const separator = topic.indexOf(':');
  if (separator === -1) return undefined;
  const family = topic.slice(0, separator);
  const scope = topic.slice(separator + 1);
  if (!scope) return undefined;

  if (family === 'session') {
    const nested = scope.indexOf(':');
    if (nested === -1) return sessionDescriptor(scope);
    const build = SESSION_DATA_SUFFIXES.get(scope.slice(nested + 1));
    return build ? build(scope.slice(0, nested)) : undefined;
  }

  const build = SCOPED_FAMILIES[family];
  return build ? build(scope) : undefined;
}
