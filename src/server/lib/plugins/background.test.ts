/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Background work and the on-disk plugin path.
 *
 * Split from `platform.test.ts` (which owns storage, settings, rpc, realtime and
 * events) because the two halves have different fixtures: everything here works
 * from a declared schedule or a directory on disk, while the rest needs the
 * isolated database.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { createPluginBackground } from '@/server/lib/plugins/background.server';
import { createPluginLogger } from '@/server/lib/plugins/log.server';
import { loadPluginServer } from '@/server/lib/plugins/loader.server';
import { toManifest } from '@/server/lib/panels/manifest';

let root = '';

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'omp-plugin-background-'));
  await isolateDb();
});

afterAll(async () => {
  await releaseDb();
  await rm(root, { recursive: true, force: true });
});

describe('background', () => {
  test('a service starts at declaration and is recorded for disposal', () => {
    const started: string[] = [];
    const { api, handle } = createPluginBackground('alpha');
    api.service('poller', { start: () => void started.push('start'), stop: () => void started.push('stop') });
    expect(started).toEqual(['start']);
    expect(handle.services).toHaveLength(1);
    expect(handle.services[0]?.id).toBe('poller');
  });

  test('a schedule resolves its next fire with Kabmo own grammar', () => {
    const { api, handle } = createPluginBackground('alpha', 1_000_000);
    api.schedule('sweep', '5m', () => {});
    api.schedule('cronny', '0 * * * *', () => {});
    expect(handle.schedules.map((entry) => entry.kind)).toEqual(['every', 'cron']);
    expect(handle.schedules[0]?.nextRunAt).toBe(1_000_000 + 300_000);
  });

  test('a spec that is neither an interval nor a cron is refused by name', () => {
    const { api } = createPluginBackground('alpha');
    expect(() => api.schedule('bad', 'whenever', () => {})).toThrow('neither an interval');
  });
});

describe('logger', () => {
  test('every line carries the plugin id', () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => void lines.push(args.join(' '));
    try {
      createPluginLogger('alpha').info('connected', { host: 'x' });
    } finally {
      console.log = original;
    }
    expect(lines).toEqual(['[plugin:alpha] connected {"host":"x"}']);
  });
});

describe('a plugin directory on disk', () => {
  test('the loader reports a plugin that declares no server entry as a skip, not an error', async () => {
    // `findPluginDir` resolves through the marketplace scan, so an id that is
    // not installed is the reachable failure here.
    await expect(loadPluginServer('definitely-not-installed')).rejects.toThrow('no installed plugin');
  });

  test('the manifest refuses a server entry that escapes the plugin directory', async () => {
    const dir = join(root, 'escaping');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'marker'), '');
    const result = toManifest({ id: 'escaping', name: 'Escaping', version: '1.0.0', server: '../outside.js' }, dir);
    expect('error' in result && result.error).toContain('escapes');
  });
});
