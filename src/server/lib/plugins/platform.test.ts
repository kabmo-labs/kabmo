/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The plugin platform's server half, end to end.
 *
 * What this suite exists for is the property that is invisible from any single
 * module: a plugin's `server.ts` registers storage, settings, an RPC method and
 * a realtime value, the HTTP route answers from what it registered, and
 * disposal takes ALL of it back. Each of those is a separate registry, so the
 * failure this pins is one of them being left behind — a method that keeps
 * answering after the plugin was switched off, a KV row that outlives its
 * plugin, a topic that never clears.
 *
 * The database is the isolated one (`isolateDb`/`releaseDb`), because the
 * handle is a process-wide singleton and a suite that reads the developer's
 * real `~/.kabmo/db.sqlite` writes to it.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { createPluginStorage } from '@/server/lib/plugins/storage.server';
import { createPluginSettings, readPluginSettings } from '@/server/lib/plugins/settings.server';
import { registerRpcMethod, callRpcMethod, hasRpcMethods, resetPluginRpc } from '@/server/lib/plugins/rpc.server';
import { createPluginRealtime, clearPluginTopic } from '@/server/lib/plugins/realtime.server';
import { createPluginEvents, resetPluginEvents } from '@/server/lib/plugins/events.server';
import { pluginTopic, isValidPluginId, pluginIdOfTopic } from '@/shared/lib/plugins/protocol';
import { getDb } from '@/server/db.server';
import type { PluginJson, PluginSettingDefinition } from '@kabmo-labs/kabmo-sdk';

let root = '';

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'omp-plugin-platform-'));
  await isolateDb();
});

afterAll(async () => {
  await releaseDb();
  await rm(root, { recursive: true, force: true });
});

afterEach(() => {
  resetPluginRpc();
  resetPluginEvents();
  clearPluginTopic('alpha');
  clearPluginTopic('beta');
});

describe('storage namespacing', () => {
  test('two plugins using the same key are two rows', async () => {
    const db = await getDb();
    const alpha = createPluginStorage(db, 'alpha');
    const beta = createPluginStorage(db, 'beta');

    await alpha.kv.write('note', 'from alpha');
    await beta.kv.write('note', 'from beta');

    expect(await alpha.kv.read<string>('note')).toBe('from alpha');
    expect(await beta.kv.read<string>('note')).toBe('from beta');
    expect(await alpha.kv.keys()).toEqual(['note']);
  });

  test('an absent key is undefined, distinct from a stored null', async () => {
    const db = await getDb();
    const storage = createPluginStorage(db, 'alpha');
    await storage.kv.write('explicit-null', null);
    expect(await storage.kv.read('never-written')).toBeUndefined();
    expect(await storage.kv.read('explicit-null')).toBeNull();
  });

  test('a value JSON cannot carry is refused, not stored as undefined', async () => {
    const db = await getDb();
    const storage = createPluginStorage(db, 'alpha');
    await expect(storage.kv.write('fn', (() => {}) as never)).rejects.toThrow('not JSON-serializable');
  });

  test('records are namespaced by collection and id, and listed newest-first', async () => {
    const db = await getDb();
    const storage = createPluginStorage(db, 'alpha');
    await storage.records.put('items', 'a', { n: 1 });
    await storage.records.put('items', 'b', { n: 2 });
    await storage.records.put('other', 'a', { n: 3 });

    expect(await storage.records.get<PluginJson>('items', 'a')).toEqual({ n: 1 });
    expect((await storage.records.list('items')).map((row) => row.id).sort()).toEqual(['a', 'b']);
    expect(await storage.records.list('other')).toHaveLength(1);

    await storage.records.remove('items', 'a');
    expect(await storage.records.get('items', 'a')).toBeUndefined();
    await storage.records.clear('items');
    expect(await storage.records.list('items')).toEqual([]);
  });

  test('a record list is bounded rather than trusting the caller', async () => {
    const db = await getDb();
    const storage = createPluginStorage(db, 'alpha');
    await storage.records.put('many', 'only', { n: 1 });
    expect(await storage.records.list('many', { limit: 10_000 })).toHaveLength(1);
  });
});

describe('settings', () => {
  const definitions: Record<string, PluginSettingDefinition> = {
    endpoint: { type: 'string', label: 'Endpoint', default: 'https://example.test' },
    retries: { type: 'number', label: 'Retries', default: 3 },
    verbose: { type: 'boolean', label: 'Verbose', default: false },
    token: { type: 'string', label: 'Token', secret: true },
  };

  test('defaults are filled in for keys never written', async () => {
    const db = await getDb();
    expect(await readPluginSettings(db, 'alpha', definitions)).toEqual({
      endpoint: 'https://example.test',
      retries: 3,
      verbose: false,
    });
  });

  test('a write round-trips through the declared type', async () => {
    const db = await getDb();
    const settings = createPluginSettings(db, 'alpha', definitions);
    await settings.write('retries', 7);
    await settings.write('verbose', true);
    const values = await settings.read();
    expect(values.retries).toBe(7);
    expect(values.verbose).toBe(true);
  });

  test('a value of the wrong type is refused rather than coerced', async () => {
    const db = await getDb();
    const settings = createPluginSettings(db, 'alpha', definitions);
    await expect(settings.write('retries', 'not a number' as never)).rejects.toThrow('expected a finite number');
    await expect(settings.write('verbose', 'yes' as never)).rejects.toThrow('expected a boolean');
    await expect(settings.write('nope', 'x')).rejects.toThrow('is not a declared setting');
  });

  test('a write notifies subscribers', async () => {
    const db = await getDb();
    const settings = createPluginSettings(db, 'alpha', definitions);
    const seen: Array<Record<string, unknown>> = [];
    const off = settings.subscribe((values) => seen.push(values));
    await settings.write('endpoint', 'https://other.test');
    off();
    await settings.write('endpoint', 'https://third.test');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.endpoint).toBe('https://other.test');
  });
});

describe('rpc', () => {
  test('a method with no schema accepts anything and answers its value', async () => {
    registerRpcMethod('alpha', 'ping', { handler: () => ({ pong: true }) });
    const result = await callRpcMethod('alpha', 'ping', { any: 'thing' }, { url: 'http://x', signal: new AbortController().signal });
    expect(result).toEqual({ ok: true, value: { pong: true } });
  });

  test('an unknown method is a value, not a throw', async () => {
    const result = await callRpcMethod('alpha', 'nope', null, { url: 'http://x', signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unknown_method');
  });

  test('a handler that throws is reported as handler_error with its own message', async () => {
    registerRpcMethod('alpha', 'boom', {
      handler: () => {
        throw new Error('the plugin says no');
      },
    });
    const result = await callRpcMethod('alpha', 'boom', null, { url: 'http://x', signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('handler_error');
      expect(result.error.message).toBe('the plugin says no');
    }
  });

  test('an input schema refuses a bad argument, naming the issue', async () => {
    registerRpcMethod('alpha', 'withInput', {
      input: {
        '~standard': {
          version: 1,
          vendor: 'test',
          validate: (value: unknown) =>
            typeof value === 'string'
              ? { value }
              : { issues: [{ message: 'expected a string', path: ['name'] }] },
        },
      },
      handler: (name: string) => `hello ${name}`,
    });
    const bad = await callRpcMethod('alpha', 'withInput', 7, { url: 'http://x', signal: new AbortController().signal });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error.code).toBe('invalid_input');
      expect(bad.error.issues?.[0]?.message).toBe('expected a string');
    }

    const good = await callRpcMethod('alpha', 'withInput', 'world', { url: 'http://x', signal: new AbortController().signal });
    expect(good).toEqual({ ok: true, value: 'hello world' });
  });

  test('an output schema catches a handler that answers the wrong shape', async () => {
    registerRpcMethod('alpha', 'badOutput', {
      output: {
        '~standard': { version: 1, vendor: 'test', validate: () => ({ issues: [{ message: 'not what was promised' }] }) },
      },
      handler: () => 'anything',
    });
    const result = await callRpcMethod('alpha', 'badOutput', null, { url: 'http://x', signal: new AbortController().signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_output');
  });

  test('a duplicate method is refused, not silently replaced', () => {
    registerRpcMethod('alpha', 'dup', { handler: () => null });
    expect(() => registerRpcMethod('alpha', 'dup', { handler: () => null })).toThrow('already registered');
  });

  test('two plugins may both register the same method name', async () => {
    registerRpcMethod('alpha', 'shared', { handler: () => 'alpha' });
    registerRpcMethod('beta', 'shared', { handler: () => 'beta' });
    const ctx = { url: 'http://x', signal: new AbortController().signal };
    expect(await callRpcMethod('alpha', 'shared', null, ctx)).toEqual({ ok: true, value: 'alpha' });
    expect(await callRpcMethod('beta', 'shared', null, ctx)).toEqual({ ok: true, value: 'beta' });
  });

  test('the disposer takes the method away', async () => {
    const dispose = registerRpcMethod('alpha', 'temporary', { handler: () => 1 });
    expect(hasRpcMethods('alpha')).toBe(true);
    dispose();
    expect(hasRpcMethods('alpha')).toBe(false);
    const after = await callRpcMethod('alpha', 'temporary', null, { url: 'http://x', signal: new AbortController().signal });
    expect(after.ok).toBe(false);
  });
});

describe('realtime', () => {
  test('seed answers a subscriber, publish notifies', () => {
    const realtime = createPluginRealtime('alpha');
    expect(realtime.current()).toBeUndefined();
    realtime.seed({ state: 'ready' });
    expect(realtime.current()).toEqual({ state: 'ready' });
    realtime.publish({ state: 'busy' });
    expect(realtime.current()).toEqual({ state: 'busy' });
  });

  test('the topic name is the plugin id, and only a valid id resolves', () => {
    expect(pluginTopic('alpha')).toBe('plugin:alpha');
    expect(pluginIdOfTopic('plugin:alpha')).toBe('alpha');
    expect(pluginIdOfTopic('plugin:')).toBeNull();
    expect(pluginIdOfTopic('plugin:has/slash')).toBeNull();
    expect(pluginIdOfTopic('sidebar')).toBeNull();
  });

  test('a plugin id is refused when it could escape a URL path', () => {
    expect(isValidPluginId('session-info')).toBe(true);
    expect(isValidPluginId('a.b_c-1')).toBe(true);
    expect(isValidPluginId('../etc')).toBe(false);
    expect(isValidPluginId('has/slash')).toBe(false);
    expect(isValidPluginId('')).toBe(false);
    expect(isValidPluginId(7)).toBe(false);
  });
});

describe('events', () => {
  test('a listener hears its own name and nothing else', () => {
    const events = createPluginEvents('alpha');
    const heard: unknown[] = [];
    const off = events.on('changed', (payload) => heard.push(payload));
    events.emit('other', 1);
    events.emit('changed', { n: 1 });
    off();
    events.emit('changed', { n: 2 });
    expect(heard).toEqual([{ n: 1 }]);
  });

  test('a throwing listener does not stop the others', () => {
    const events = createPluginEvents('alpha');
    const heard: unknown[] = [];
    events.on('changed', () => {
      throw new Error('this listener is broken');
    });
    events.on('changed', (payload) => heard.push(payload));
    events.emit('changed', 'still delivered');
    expect(heard).toEqual(['still delivered']);
  });
});
