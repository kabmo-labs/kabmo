/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The install route keeps a plugin's SERVER half in step with its on-disk state.
 *
 * A plugin's server half is otherwise loaded once at BOOT, so a plugin installed
 * into a running Kabmo answered no topic and refused its RPC methods until a
 * restart — which a panel could only report as an empty view. The install route
 * now loads (or unloads) the half itself, and these tests drive that route the
 * way the settings pane does.
 *
 * The assertions are on the LOADER's own registry rather than on the HTTP
 * payload, because "is it live?" is the whole question: a 200 that left the
 * plugin unloaded is exactly the bug this exists to catch. The failure list is
 * asserted too, since a load that throws must reach the PANE (`GET
 * /api/plugins`) and not only the server log.
 */

import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { join } from 'node:path';

import { action as installAction } from '@/server/routes/panels/install';
import { getMarketplacePluginsDir, invalidatePanelScan } from '@/server/lib/panels/registry.server';
import { loadedPlugin, pluginLoadErrors } from '@/server/lib/plugins/loader.server';
import { post, usePanelRouteFixtures, writeServerPlugin } from '@/server/routes/panels/panel-routes.test-util';

usePanelRouteFixtures();

describe('the install route and the server half', () => {
  test('enable loads the server half, disable unloads it', async () => {
    writeServerPlugin('live', getMarketplacePluginsDir());
    invalidatePanelScan();

    const on = await post(installAction, { type: 'enable', pluginId: 'live' });
    expect(on.status).toBe(200);
    expect(loadedPlugin('live')).toBeDefined();

    const off = await post(installAction, { type: 'disable', pluginId: 'live' });
    expect(off.status).toBe(200);
    // Unloaded, so its routes and RPC methods stop answering — which is what
    // makes disabling stop the code rather than only hide the button.
    expect(loadedPlugin('live')).toBeUndefined();
  });

  test('a plugin whose server half cannot load still installs', async () => {
    // The reported shape: the files land, the catalog records them, and the
    // failure is a LOG line. A 400 here would hide a successful install behind
    // an unrelated fault, and the panel is what explains the missing half.
    // The factory THROWS rather than the entry being absent, so this is the
    // load failing rather than the scan refusing the plugin outright.
    const dir = writeServerPlugin('broken', getMarketplacePluginsDir());
    fs.writeFileSync(join(dir, 'dist', 'server.js'), 'export default function plugin() { throw new Error("boom"); }\n');
    invalidatePanelScan();

    const response = await post(installAction, { type: 'enable', pluginId: 'broken' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(loadedPlugin('broken')).toBeUndefined();
    // The failure must reach the PANE, not only the log: `GET /api/plugins`
    // serves this list, and a runtime failure that never lands there leaves the
    // user with a silent panel and no reason.
    expect(pluginLoadErrors().some((entry) => entry.pluginId === 'broken')).toBe(true);
  });

  test('a later successful enable clears the recorded failure', async () => {
    // Otherwise the pane keeps reporting a fault the user has already fixed.
    //
    // The failure is TRANSIENT by construction: the factory reads a global at
    // CALL time and throws only while it is unset. That is the honest shape of
    // what this clear is for — the MODULE stays cached by Bun, so a repaired
    // `server.js` needs a restart, while a factory that threw once (a lock, a
    // race, a dependency that was not ready) succeeds when it is called again.
    const dir = writeServerPlugin('flaky', getMarketplacePluginsDir());
    fs.writeFileSync(
      join(dir, 'dist', 'server.js'),
      'export default function plugin(api) { if (!globalThis.__flakyOk) throw new Error("boom"); api.rpc.register("ping", { handler: () => ({ pong: true }) }); }\n',
    );
    invalidatePanelScan();
    await post(installAction, { type: 'enable', pluginId: 'flaky' });
    expect(pluginLoadErrors().some((entry) => entry.pluginId === 'flaky')).toBe(true);
    expect(loadedPlugin('flaky')).toBeUndefined();

    // The condition clears and the user switches the plugin on again.
    Reflect.set(globalThis, '__flakyOk', true);
    await post(installAction, { type: 'enable', pluginId: 'flaky' });
    expect(loadedPlugin('flaky')).toBeDefined();
    expect(pluginLoadErrors().some((entry) => entry.pluginId === 'flaky')).toBe(false);
    Reflect.deleteProperty(globalThis, '__flakyOk');
  });
});
