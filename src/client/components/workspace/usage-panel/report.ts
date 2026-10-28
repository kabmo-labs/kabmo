/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Picking which of the panel's two reports to render.
 *
 * The right panel has two read paths for the same question: the realtime `usage`
 * topic (the read path — the server pushes when a provider or key changes) and
 * `GET /api/settings/usage` (the first paint, and the user's own Refresh, which
 * forces past the server's one-minute quota cache).
 *
 * Precedence cannot be a fixed `topic ?? http`: the manual Refresh returns the
 * FRESHER report over HTTP while the topic still holds its earlier snapshot, so
 * the refresh would look like it did nothing. Both payloads carry the
 * server's own `generatedAt`, so the later read wins and the two paths cannot
 * disagree about which is current.
 */

import type { UsageReport } from '@/shared/types';

/** The later of the two reports; either alone when only one has arrived. */
export function newestUsageReport(
  fromTopic: UsageReport | null,
  fromHttp: UsageReport | null,
): UsageReport | null {
  if (!fromTopic) return fromHttp;
  if (!fromHttp) return fromTopic;
  const topicAt = Date.parse(fromTopic.generatedAt);
  const httpAt = Date.parse(fromHttp.generatedAt);
  // An unparseable timestamp cannot be ordered; the pushed value is the one the
  // server considers current, so it stays.
  if (Number.isNaN(topicAt) || Number.isNaN(httpAt)) return fromTopic;
  return httpAt > topicAt ? fromHttp : fromTopic;
}
