/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `usage` topic's payload SHAPE, and its agreement with the HTTP route.
 *
 * The right panel renders `usage.data ?? fetched` — one report, two read paths.
 * The topic resolved the provider ROWS while the route answered the report
 * ENVELOPE, so `buildProviders(report)` ran `report.providers.map` on
 * `undefined` and the panel threw `Cannot read properties of undefined
 * (reading 'map')` on open. A shape mismatch here is not a stale reading; it is
 * a crash, which is why both paths go through `buildUsageReport`.
 *
 * MOCK is forced on so the assertion needs no credential, no omp child and no
 * network — the shape is what is under test, not the probe.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { globalDescriptor } from '@/server/lib/realtime/topics/global.server';
import { TOPIC_USAGE } from '@/shared/lib/realtime/protocol';

const originalMock = Bun.env.MOCK;

beforeAll(() => {
  Bun.env.MOCK = 'true';
});

afterAll(() => {
  if (originalMock === undefined) delete Bun.env.MOCK;
  else Bun.env.MOCK = originalMock;
});

describe('usage topic', () => {
  test('resolves the report envelope, not the provider rows', async () => {
    const payload = (await globalDescriptor(TOPIC_USAGE).resolve(TOPIC_USAGE)) as {
      isMock?: boolean;
      generatedAt?: string;
      providers?: unknown;
    };

    // The envelope, and specifically an ARRAY under `providers` — the property
    // both consumers map over.
    expect(Array.isArray(payload.providers)).toBe(true);
    expect(payload.isMock).toBe(true);
    expect(Number.isNaN(Date.parse(payload.generatedAt ?? ''))).toBe(false);
  });
});
