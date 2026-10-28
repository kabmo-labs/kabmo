/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `claimPort` — the bind decision, and its whole value is in the failure path:
 * a starter that loses must fail with a message that names the real situation
 * instead of a bare `EADDRINUSE`.
 *
 * The cases drive real listeners on OS-assigned ports, because the question is
 * about sockets. One of them is the reported bug: `localhost` stands for two
 * addresses, the guard asked about only the one Bun would bind, and a stale
 * instance kept the other — two servers on one port, and a browser landing on
 * whichever family it resolved.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { testPosix } from '@/test-support/platform';

import { claimPort, PortInUseError } from '@/server/lib/lifecycle/port-guard';
import { createLoopbackHarness, ipv6Loopback, realFetch } from '@/test-support/loopback';

const harness = createLoopbackHarness();
const { occupy, occupyAt, freePort, freePortBothFamilies, livePid, spawnChamberHolder } = harness;

let tempDir: string;
let originalDataDir: string | undefined;

beforeEach(() => {
  // The instance record and the port lock both live under the data directory;
  // pointing it at a temp dir keeps a test from reading (or writing) the real
  // `~/.kabmo/run`.
  originalDataDir = Bun.env.KABMO_DATA_DIR;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-test-claim-port-'));
  Bun.env.KABMO_DATA_DIR = tempDir;
  globalThis.fetch = realFetch;
});

afterEach(async () => {
  await harness.dispose();
  if (originalDataDir === undefined) delete Bun.env.KABMO_DATA_DIR;
  else Bun.env.KABMO_DATA_DIR = originalDataDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('claimPort', () => {
  test('binds a free port through the injected listen', async () => {
    const port = await freePort();
    let binds = 0;

    await claimPort({ port, host: '127.0.0.1', listen: async () => { binds += 1; } });

    expect(binds).toBe(1);
  });

  test('re-binds when the occupant is this very process', async () => {
    // `bun run --hot` re-evaluates the entry inside the running process, so the
    // port is held by us and Bun swaps the handler on the next listen. Killing
    // the dev loop on every save is the failure this prevents.
    const { port } = occupy(() => Response.json({ service: 'kabmo', pid: process.pid }));
    let binds = 0;

    await claimPort({ port, host: '127.0.0.1', listen: async () => { binds += 1; } });

    expect(binds).toBe(1);
  });

  testPosix('names a Kabmo occupant held by another process', async () => {
    const holder = await spawnChamberHolder();
    const { port } = occupy(() => Response.json({ service: 'kabmo', pid: holder.pid, version: '9.9.9' }));
    let binds = 0;

    const error = await claimPort({ port, host: '127.0.0.1', listen: async () => { binds += 1; } })
      .then(() => null, (thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(PortInUseError);
    const message = (error as Error).message;
    expect(message).toContain(`Port ${port} is already served by Kabmo`);
    expect(message).toContain(`pid ${holder.pid}`);
    expect(message).toContain('v9.9.9');
    expect(message).toContain('Nothing was stopped');
    // A starting instance never binds over an identified one.
    expect(binds).toBe(0);
  });

  test('names a foreign listener as not Kabmo, without a bind error', async () => {
    // Nothing answers `/api/health` and nothing identifies itself, so the probe
    // fails first and `listen` is never attempted.
    const { port } = occupy(() => new Response('not kabmo'));
    let binds = 0;

    const error = await claimPort({ port, host: '127.0.0.1', listen: async () => { binds += 1; } })
      .then(() => null, (thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(PortInUseError);
    const message = (error as Error).message;
    expect(message).toContain(`Port ${port} is in use by another process`);
    expect(message).toContain(`lsof -nP -iTCP:${port} -sTCP:LISTEN`);
    expect(message).not.toContain('Bind error');
    expect(binds).toBe(0);
  });

  test.skipIf(!ipv6Loopback)('refuses a name whose OTHER address is held', async () => {
    // The reported bug: a stale instance held `127.0.0.1:3000`, `bun run dev`
    // probed only `localhost`'s other family (`::1`), found it free, and bound
    // it. Two servers, one port, and a browser landing on whichever family it
    // resolved — the stale one, serving a different data mode.
    const port = await freePortBothFamilies();
    // A listener reporting OUR pid is read as this process re-binding, so the
    // occupant has to name another live process to be refused.
    const holder = await livePid();
    const held = occupyAt(port, '127.0.0.1', () => Response.json({ service: 'kabmo', pid: holder }));
    let binds = 0;

    const error = await claimPort({ port, host: 'localhost', listen: async () => { binds += 1; } })
      .then(() => null, (thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(PortInUseError);
    const message = (error as Error).message;
    expect(message).toContain(`Port ${port} is already served by Kabmo`);
    // The address clause is the actionable half: `lsof` lists both sockets, so
    // a bare "port busy" does not say which one has to be freed.
    expect(message).toContain('on 127.0.0.1');
    expect(binds).toBe(0);

    held.stop(true);
  });

  test.skipIf(!ipv6Loopback)('binds a name whose addresses are both free', async () => {
    const port = await freePortBothFamilies();
    let binds = 0;

    await claimPort({ port, host: 'localhost', listen: async () => { binds += 1; } });

    expect(binds).toBe(1);
  });

  test('carries the bind error when the port looked free', async () => {
    // The probe is only a short-circuit; when `listen` fails anyway, the real
    // reason must survive into the error rather than being replaced by a guess.
    const port = await freePort();

    const error = await claimPort({
      port,
      host: '127.0.0.1',
      listen: async () => { throw new Error('EADDRINUSE: address already in use'); },
    }).then(() => null, (thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(PortInUseError);
    expect((error as Error).message).toContain('Bind error: EADDRINUSE: address already in use');
  });
});
