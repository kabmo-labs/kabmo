/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The GLOBAL topics: `usage`, `schedule`, `panels` and `models`.
 *
 * None is scoped to a session or a workspace, and all four describe state the
 * Kabmo reads from a library the HTTP routes already call — so each resolver
 * here is a direct call, with no route extraction needed.
 *
 * `panels` and `models` are large payloads produced on demand, so their
 * publishers re-snapshot the topic rather than streaming every intermediate
 * state.
 */

import {
  TOPIC_MODELS,
  TOPIC_PANELS,
  TOPIC_SCHEDULE,
  TOPIC_USAGE,
  TOPIC_WAITING,
} from '@/shared/lib/realtime/protocol';
import { type TopicDescriptor } from '@/server/lib/realtime/hub.server';
import { listScheduledTasks } from '@/server/lib/schedule/store.server';
import { listWaitingPrompts } from '@/server/lib/waiting/store.server';
import { buildUsageReport } from '@/server/lib/usage/report.server';
import { discoverPanelPlugins } from '@/server/lib/panels/registry.server';
import { loadModelsWithCache } from '@/server/lib/models/registry.server';

/**
 * Every resolver is a direct call: each topic describes state Kabmo reads
 * from a library its HTTP route already calls, so there is no read logic here to
 * share or to drift.
 */
const RESOLVERS: Record<string, () => Promise<unknown>> = {
  [TOPIC_SCHEDULE]: () => listScheduledTasks(),
  // The waiting list is the same read the runtime sweeps over, so a client and
  // the dispatcher can never disagree about which prompt is still held.
  [TOPIC_WAITING]: () => listWaitingPrompts(),
  // The SAME builder `GET /api/settings/usage` answers with: the panel renders
  // whichever path arrived first, so the two payloads must not diverge.
  [TOPIC_USAGE]: () => buildUsageReport(),
  [TOPIC_PANELS]: () => discoverPanelPlugins(),
  [TOPIC_MODELS]: () => loadModelsWithCache(),
};

/**
 * A descriptor for one global topic. The resolver is picked by topic name, so a
 * name with no resolver is a topic the hub does not serve.
 */
export function globalDescriptor(topic: string): TopicDescriptor {
  const resolve = RESOLVERS[topic];
  if (!resolve) throw new Error(`No global resolver for ${topic}`);
  return { resolve };
}
