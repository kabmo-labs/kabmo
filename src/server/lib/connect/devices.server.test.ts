/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The last-connect timestamp.
 *
 * The Settings page reads `last_seen_at` as "Last connect", and the only writer
 * that fires on ordinary use is the auth gate's `markDeviceConnected`. Pairing
 * alone is not a connect: a device that redeemed a code but never opened the
 * console must stay unmarked, which is what the first case pins.
 *
 * The throttle is deliberate — the gate runs on every request, so a write per
 * frame would be a database write in front of every page load. The second case
 * pins that a burst of requests moves the timestamp once.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { getDb } from '@/server/db.server';
import {
  ensureConnectSchema,
  listPairedDevices,
  markDeviceConnected,
  mintDeviceToken,
} from '@/server/lib/connect/devices.server';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';

beforeEach(async () => {
  await isolateDb();
  globalThis.__kabmoDeviceMarks = new Map();
  globalThis.__kabmoDeviceTokens = new Map();
  await ensureConnectSchema(await getDb());
});

afterEach(async () => {
  await releaseDb();
});

describe('last connect', () => {
  test('a freshly paired device has not connected yet', async () => {
    await mintDeviceToken({ name: 'Phone', platform: 'ios' });
    const [device] = await listPairedDevices();
    expect(device?.lastSeenAt).toBeNull();
  });

  test('a token use records the time', async () => {
    const device = await mintDeviceToken({ name: 'Phone', platform: 'ios' });
    const before = Date.now();
    await markDeviceConnected(device.id);

    const [listed] = await listPairedDevices();
    expect(listed?.lastSeenAt).not.toBeNull();
    const at = Date.parse(listed?.lastSeenAt ?? '');
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });

  test('a burst of requests moves the timestamp once per window', async () => {
    const device = await mintDeviceToken({ name: 'Phone', platform: 'ios' });
    await markDeviceConnected(device.id);
    const first = (await listPairedDevices())[0]?.lastSeenAt;

    await markDeviceConnected(device.id);
    await markDeviceConnected(device.id);

    expect((await listPairedDevices())[0]?.lastSeenAt).toBe(first ?? null);
  });
});
