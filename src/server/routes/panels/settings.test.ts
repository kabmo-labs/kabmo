/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A panel plugin's settings route: the schema it reads and the values it writes.
 *
 * Every case here is one a wrong answer hides: a disabled plugin must still be
 * configurable (its form is server-rendered, not run by the plugin), a secret
 * must never travel back to the browser, the mask the browser sends back when a
 * field is untouched must not overwrite the credential, and an undeclared key
 * must be refused rather than stored where the plugin would never read it.
 */

import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { join } from 'node:path';

import { action, loader } from '@/server/routes/panels/settings';
import { discoverPanelPlugins, getMarketplacePluginsDir, invalidatePanelScan } from '@/server/lib/panels/registry.server';
import { setPluginEnabled } from '@/server/lib/panels/state.server';
import { getDb } from '@/server/db.server';
import { readPluginSettings } from '@/server/lib/plugins/settings.server';
import { PLUGIN_SECRET_MASK } from '@/shared/lib/plugins/settings';
import type { PluginSettingDefinition } from '@kabmo-labs/kabmo-sdk';
import { call, dirs, usePanelRouteFixtures, writePlugin } from '@/server/routes/panels/panel-routes.test-util';

usePanelRouteFixtures();

const SCHEMA: Record<string, PluginSettingDefinition> = {
  note: { type: 'string', label: 'Note', default: 'hello' },
  retries: { type: 'number', label: 'Retries', default: 3 },
  verbose: { type: 'boolean', label: 'Verbose', default: false },
  token: { type: 'string', label: 'Token', secret: true, default: '' },
};

/** A plugin whose settings come from `settings-schema.json`. */
function writeSettingsPlugin(dirName = 'demo'): string {
  const dir = writePlugin(dirName, getMarketplacePluginsDir());
  fs.writeFileSync(join(dir, 'settings-schema.json'), JSON.stringify(SCHEMA));
  invalidatePanelScan();
  return dir;
}

function put(plugin: string, body: unknown): Promise<Response> {
  return action({
    params: { plugin },
    request: new Request(`http://local/api/panels/settings/${plugin}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as never) as Promise<Response>;
}

async function jsonBody(response: Response) {
  return (await response.json()) as {
    error?: string;
    definitions?: Record<string, unknown>;
    values?: Record<string, unknown>;
  };
}

describe('GET /api/panels/settings/:plugin', () => {
  test('answers the definitions and the defaults they declare', async () => {
    writeSettingsPlugin();
    const response = await call(loader, { plugin: 'demo' });
    expect(response.status).toBe(200);
    const body = await jsonBody(response);
    expect(Object.keys(body.definitions ?? {})).toEqual(['note', 'retries', 'verbose', 'token']);
    // `token` declares a default, but a secret default is not a stored value:
    // reporting it masked would tell the form a credential exists when none does.
    expect(body.values).toEqual({ note: 'hello', retries: 3, verbose: false });
  });

  test('404s a plugin that is not installed', async () => {
    expect((await call(loader, { plugin: 'nope' })).status).toBe(404);
  });

  test('still answers for a DISABLED plugin, whose form is not run by its code', async () => {
    writeSettingsPlugin();
    await setPluginEnabled('plugin:demo', false);
    invalidatePanelScan();

    const response = await call(loader, { plugin: 'demo' });
    expect(response.status).toBe(200);
    expect((await jsonBody(response)).definitions?.note).toBeDefined();
  });

  test('reports a schema that exists but does not parse', async () => {
    const dir = writePlugin('broken', getMarketplacePluginsDir());
    fs.writeFileSync(join(dir, 'settings-schema.json'), '{ nope');
    invalidatePanelScan();

    const payload = await discoverPanelPlugins();
    expect(payload.plugins.some((plugin) => plugin.pluginId === 'broken')).toBe(false);
    expect(payload.errors.some((error) => error.reason.includes('settings-schema.json'))).toBe(true);
  });
});

describe('PUT /api/panels/settings/:plugin', () => {
  test('writes a value and answers the new state', async () => {
    writeSettingsPlugin();
    const response = await put('demo', { values: { note: 'changed', retries: 9, verbose: true } });
    expect(response.status).toBe(200);
    expect((await jsonBody(response)).values).toEqual({ note: 'changed', retries: 9, verbose: true });

    expect((await jsonBody(await call(loader, { plugin: 'demo' }))).values).toEqual({
      note: 'changed',
      retries: 9,
      verbose: true,
    });
  });

  test('refuses an undeclared key instead of storing it', async () => {
    writeSettingsPlugin();
    const response = await put('demo', { values: { nope: 'x' } });
    expect(response.status).toBe(400);
    expect((await jsonBody(response)).error).toContain('not a declared setting');
  });

  test('refuses a value of the wrong type before writing any field', async () => {
    writeSettingsPlugin();
    const response = await put('demo', { values: { note: 'kept?', retries: 'many' } });
    expect(response.status).toBe(400);

    const db = await getDb();
    expect(await readPluginSettings(db, 'demo', SCHEMA)).toMatchObject({ note: 'hello', retries: 3 });
  });

  test('never returns a secret, and the mask sent back does not overwrite it', async () => {
    writeSettingsPlugin();
    await put('demo', { values: { token: 'secret-token' } });

    const read = await jsonBody(await call(loader, { plugin: 'demo' }));
    expect(read.values?.token).toBe(PLUGIN_SECRET_MASK);

    // What the form sends when the user did not touch the field.
    const untouched = await put('demo', { values: { token: PLUGIN_SECRET_MASK } });
    expect(untouched.status).toBe(200);

    const db = await getDb();
    expect((await readPluginSettings(db, 'demo', SCHEMA)).token).toBe('secret-token');
  });

  test('refuses a body that carries no values object', async () => {
    writeSettingsPlugin();
    expect((await put('demo', {})).status).toBe(400);
  });

  test('405s a verb other than PUT', async () => {
    writeSettingsPlugin();
    const response = (await action({
      params: { plugin: 'demo' },
      request: new Request('http://local/api/panels/settings/demo', { method: 'POST' }),
    } as never)) as Response;
    expect(response.status).toBe(405);
  });
});

/** The marketplace root the fixture created, asserted here so an empty scan is explainable. */
test('the fixture marketplace is the one the scan reads', () => {
  expect(getMarketplacePluginsDir()).toBe(join(dirs.root, 'plugins'));
});
