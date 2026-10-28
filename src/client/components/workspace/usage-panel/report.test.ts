/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which of the panel's two reports is rendered.
 *
 * The right panel reads the same question twice: the realtime `usage` topic and
 * `GET /api/settings/usage`. The HTTP read is what the user's own Refresh uses,
 * and it forces past the server's one-minute quota cache — so a fixed
 * `topic ?? http` precedence would keep rendering the topic's earlier snapshot
 * and the refresh would look like it did nothing. The server's own
 * `generatedAt` is what orders them.
 */

import { describe, expect, test } from 'bun:test';
import { newestUsageReport } from '@/client/components/workspace/usage-panel/report';
import type { UsageReport } from '@/shared/types';

const report = (generatedAt: string, providerId = 'p'): UsageReport => ({
  isMock: false,
  generatedAt,
  providers: [
    {
      id: providerId,
      name: providerId,
      credentialSources: [],
      tracked: false,
      limits: [],
    },
  ],
});

describe('newestUsageReport', () => {
  test('the fresher HTTP report wins over an older topic snapshot', () => {
    // The refresh case: the topic still holds what it pushed a minute ago.
    const topic = report('2026-01-01T00:00:00.000Z', 'stale');
    const http = report('2026-01-01T00:01:00.000Z', 'fresh');
    expect(newestUsageReport(topic, http)?.providers[0]?.id).toBe('fresh');
  });

  test('a newer topic snapshot wins over an older HTTP read', () => {
    const topic = report('2026-01-01T00:02:00.000Z', 'fresh');
    const http = report('2026-01-01T00:00:00.000Z', 'stale');
    expect(newestUsageReport(topic, http)?.providers[0]?.id).toBe('fresh');
  });

  test('either alone is returned as-is', () => {
    const only = report('2026-01-01T00:00:00.000Z');
    expect(newestUsageReport(only, null)).toBe(only);
    expect(newestUsageReport(null, only)).toBe(only);
    expect(newestUsageReport(null, null)).toBeNull();
  });

  test('an unparseable timestamp keeps the pushed value', () => {
    const topic = report('not-a-date', 'pushed');
    const http = report('2026-01-01T00:00:00.000Z', 'http');
    expect(newestUsageReport(topic, http)?.providers[0]?.id).toBe('pushed');
  });
});
