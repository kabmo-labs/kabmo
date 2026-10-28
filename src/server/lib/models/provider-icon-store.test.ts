/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The provider-icon table: one row per provider, the bytes of its site's icon.
 *
 * Isolated (`isolateDb`) because the handle is a process-wide singleton and the
 * writes here are real — a suite that skipped this would put a fake provider's
 * icon into the developer's own `~/.kabmo/db.sqlite`.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getDb } from '@/server/db.server';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import {
  deleteProviderIcon,
  ensureProviderIconSchema,
  readProviderIcon,
  readProviderIconStamps,
  writeProviderIcon,
} from '@/server/lib/models/provider-icon-store.server';

beforeEach(async () => {
  await isolateDb();
  await ensureProviderIconSchema(await getDb());
});

afterEach(async () => {
  await releaseDb();
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe('provider_icons', () => {
  test('a stored icon round-trips its bytes, type and source', async () => {
    const db = await getDb();
    await writeProviderIcon(db, {
      slug: 'kenari',
      status: 'ok',
      mime: 'image/png',
      bytes: PNG,
      source: 'https://kenari.id/apple-touch-icon.png',
      fetchedAt: 1_700_000_000_000,
    });

    const stored = await readProviderIcon(db, 'kenari');
    expect(stored?.status).toBe('ok');
    expect(stored?.mime).toBe('image/png');
    expect(stored?.source).toBe('https://kenari.id/apple-touch-icon.png');
    expect(stored?.fetchedAt).toBe(1_700_000_000_000);
    expect([...(stored?.bytes ?? [])]).toEqual([...PNG]);
  });

  test('a MISS is a row too, so the next load does not retry the host', async () => {
    const db = await getDb();
    await writeProviderIcon(db, {
      slug: 'private-gateway',
      status: 'missing',
      error: 'no usable icon on the endpoint host',
      fetchedAt: 1_700_000_000_000,
    });

    const stored = await readProviderIcon(db, 'private-gateway');
    expect(stored?.status).toBe('missing');
    expect(stored?.bytes).toBeUndefined();
    expect(stored?.error).toContain('no usable icon');
  });

  test('a rewrite replaces the row rather than accumulating one', async () => {
    const db = await getDb();
    const base = { slug: 'gateway', status: 'missing' as const, fetchedAt: 1 };
    await writeProviderIcon(db, base);
    await writeProviderIcon(db, {
      slug: 'gateway',
      status: 'ok',
      mime: 'image/png',
      bytes: PNG,
      fetchedAt: 2,
    });

    expect((await readProviderIconStamps(db)).size).toBe(1);
    expect((await readProviderIcon(db, 'gateway'))?.status).toBe('ok');
  });

  test('the stamps carry no bytes — that is the point of the split', async () => {
    const db = await getDb();
    await writeProviderIcon(db, {
      slug: 'kenari', status: 'ok', mime: 'image/png', bytes: PNG, fetchedAt: 42,
    });

    const stamps = await readProviderIconStamps(db);
    expect(stamps.get('kenari')).toEqual({ status: 'ok', fetchedAt: 42 });
  });

  test('deleting a row forgets the icon so the next read refetches', async () => {
    const db = await getDb();
    await writeProviderIcon(db, { slug: 'kenari', status: 'ok', bytes: PNG, fetchedAt: 1 });
    await deleteProviderIcon(db, 'kenari');
    expect(await readProviderIcon(db, 'kenari')).toBeNull();
  });

  test('an unknown provider has no row', async () => {
    expect(await readProviderIcon(await getDb(), 'nope')).toBeNull();
  });
});
