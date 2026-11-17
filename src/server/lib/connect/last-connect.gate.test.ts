/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The gate is what records "last connect".
 *
 * No shell reports its connection after pairing, so a timestamp written only by
 * `POST /api/connect/devices` would leave every real device reading "Never
 * connected" while it is open. This case starts at the actual entry point — a
 * request carrying the device token — and reads the row the Settings page
 * reads back.
 */

import { afterEach, beforeEach, expect, test } from 'bun:test';
import path from 'node:path';

import { authGate, initAuth } from '@/server/lib/auth/guard';
import { getDb } from '@/server/db.server';
import {
  ensureConnectSchema,
  listPairedDevices,
  mintDeviceToken,
} from '@/server/lib/connect/devices.server';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';

beforeEach(async () => {
  const dbPath = await isolateDb();
  Bun.env.KABMO_DATA_DIR = path.dirname(dbPath);
  globalThis.__kabmoDeviceMarks = new Map();
  globalThis.__kabmoDeviceTokens = new Map();
  await ensureConnectSchema(await getDb());
});

afterEach(async () => {
  await initAuth(null);
  delete Bun.env.KABMO_DATA_DIR;
  await releaseDb();
});

test('an authenticated device request moves the last-connect timestamp', async () => {
  await initAuth('correct horse battery staple');
  const device = await mintDeviceToken({ name: 'Phone', platform: 'ios' });
  expect((await listPairedDevices())[0]?.lastSeenAt).toBeNull();

  const request = new Request('http://localhost/api/settings', {
    headers: { authorization: `Bearer ${device.token}` },
  });
  expect(await authGate(request)).toBeUndefined();
  expect((await listPairedDevices())[0]?.lastSeenAt).not.toBeNull();
});
