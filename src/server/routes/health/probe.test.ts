/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `pluginsReady` on `GET /api/health`, and why the field exists at all.
 *
 * The listener answers health before the boot's plugin pass runs, and the
 * console reloads the page the moment health reports a different process — so
 * the reloaded page can issue a plugin RPC against a server whose halves are
 * still being imported, and get a 404 that is indistinguishable from "this
 * plugin is not installed". The field is what lets the client tell the two
 * apart; without it the client cannot retry the boot window at all.
 *
 * Read through the route's own `loader`, because the fact has one consumer and
 * the payload is the contract: a test of the flag alone would pass while the
 * route stopped publishing it.
 */

import { afterEach, describe, expect, test } from 'bun:test';

import { loader } from '@/server/routes/health/probe';
import { markPluginPlatformReady } from '@/server/lib/plugins/loader.server';

/** The flag is process-wide, so each case sets the state it is about. */
function setReady(value: boolean | undefined): void {
  (globalThis as unknown as Record<string, unknown>).__kabmoPluginPlatformReady = value;
}

afterEach(() => {
  setReady(undefined);
});

async function health(): Promise<Record<string, unknown>> {
  return (await (await loader()).json()) as Record<string, unknown>;
}

describe('GET /api/health', () => {
  test('reports the plugin pass as unfinished before it has run', async () => {
    setReady(undefined);
    expect((await health()).pluginsReady).toBe(false);
  });

  test('reports it finished once the pass is done', async () => {
    markPluginPlatformReady();
    expect((await health()).pluginsReady).toBe(true);
  });

  test('still answers the identity the restart watch reads', async () => {
    // The field rides along with the facts that already exist; a payload that
    // lost `pid`/`startedAt` would break the restart flow that motivated it.
    const payload = await health();
    expect(payload.pid).toBe(process.pid);
    expect(typeof payload.startedAt).toBe('string');
    expect(payload.service).toBe('kabmo');
  });
});
