/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The IDENTIFICATION half of `probe.ts`: `GET /api/health`, which is how every
 * CLI command and the port guard find out who is on a port.
 *
 * The cases run against real HTTP stubs on loopback, because the questions are
 * about a real exchange — a status code, a body's shape, a scheme, and which
 * ADDRESS the request was aimed at. That last one is the reported bug: a
 * single-address request for a name that stands for two sockets reported a live
 * instance as absent, so `status` and `stop` saw nothing while a browser kept
 * landing on it.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { fetchHealth } from '@/server/lib/lifecycle/probe';
import { createLoopbackHarness, ipv6Loopback, realFetch } from '@/test-support/loopback';

const harness = createLoopbackHarness();
const { occupy, occupyAt, freePort, freePortBothFamilies } = harness;

/**
 * Another file in the same `bun test` process may have left a stub installed on
 * the global, and every case here talks to a REAL listener it just started on
 * loopback — so the global is put back before each one rather than trusting the
 * ambient one.
 */
beforeEach(() => {
  globalThis.fetch = realFetch;
});

afterEach(async () => {
  await harness.dispose();
});

afterAll(async () => {
  await harness.dispose();
});

describe('fetchHealth', () => {
  test('returns the payload of a Kabmo listener, keeping only known fields', async () => {
    const full = occupy(() => Response.json({
      service: 'kabmo',
      pid: 4242,
      version: '3.10.1',
      startedAt: '2026-01-01T00:00:00.000Z',
      uptime: 12.5,
      mock: false,
      runtime: 'bun',
      mode: 'dev',
      port: 1234,
      host: '127.0.0.1',
      tls: false,
      tray: true,
      authEnabled: true,
      fds: { open: 3352, highest: 3351, limit: 61_440, nearCliff: false },
      extra: 'dropped',
    }));

    const health = await fetchHealth(full.port, '127.0.0.1', 1000, false);

    expect(health).toEqual({
      service: 'kabmo',
      pid: 4242,
      version: '3.10.1',
      startedAt: '2026-01-01T00:00:00.000Z',
      uptime: 12.5,
      mock: false,
      runtime: 'bun',
      mode: 'dev',
      port: 1234,
      host: '127.0.0.1',
      tls: false,
      tray: true,
      authEnabled: true,
      // Carried, not dropped: `status` prints this as its warning line, and
      // whitelisting it away left the report without one.
      fds: { open: 3352, highest: 3351, limit: 61_440, nearCliff: false },
    });
  });

  test('reports a malformed fds field as null rather than a half-trusted object', async () => {
    const partial = occupy(() => Response.json({
      service: 'kabmo',
      fds: { open: 1, highest: 1, limit: 2 },
    }));

    const health = await fetchHealth(partial.port, '127.0.0.1', 1000, false);

    expect(health?.service).toBe('kabmo');
    expect(health?.fds).toBeNull();
  });

  test('drops fields whose type is wrong rather than passing them on', async () => {
    const mistyped = occupy(() => Response.json({ service: 'kabmo', pid: '4242', version: 7, tls: 'yes' }));

    const health = await fetchHealth(mistyped.port, '127.0.0.1', 1000, false);

    expect(health?.service).toBe('kabmo');
    expect(health?.pid).toBeUndefined();
    expect(health?.version).toBeUndefined();
    expect(health?.tls).toBeUndefined();
  });

  test.skipIf(!ipv6Loopback)('finds a listener on either address of a name', async () => {
    // `localhost` is two sockets and a server binds one. Asking only the family
    // Bun happens to pick left the other instance undiscoverable: `kabmo status`
    // and `kabmo stop` reported nothing while the browser kept reaching it.
    const port = await freePortBothFamilies();
    const health = () => Response.json({ service: 'kabmo', pid: process.pid });

    const v4 = occupyAt(port, '127.0.0.1', health);
    expect((await fetchHealth(port, 'localhost', 1000, false))?.service).toBe('kabmo');
    v4.stop(true);

    const v6 = occupyAt(port, '::1', health);
    expect((await fetchHealth(port, 'localhost', 1000, false))?.service).toBe('kabmo');
    v6.stop(true);
  });

  test('recognizes a pre-rename listener, and reports it under the current name', async () => {
    // A server started before the rename is still running the old build: its
    // health payload says `ompchamber`, and `status`/`stop` must still find it.
    const legacy = occupy(() => Response.json({ service: 'ompchamber', pid: 4242, port: 3000 }));

    const health = await fetchHealth(legacy.port, '127.0.0.1', 1000, false);

    expect(health?.service).toBe('kabmo');
    expect(health?.pid).toBe(4242);
  });

  test('ignores a listener that is not Kabmo', async () => {
    const foreign = occupy(() => Response.json({ service: 'something-else', pid: process.pid }));
    expect(await fetchHealth(foreign.port, '127.0.0.1', 1000, false)).toBeNull();
  });

  test('ignores error responses, non-JSON bodies, and non-objects', async () => {
    const broken = occupy(() => new Response('nope', { status: 500 }));
    expect(await fetchHealth(broken.port, '127.0.0.1', 1000, false)).toBeNull();

    const html = occupy(() => new Response('<html>not json</html>', { headers: { 'content-type': 'text/html' } }));
    expect(await fetchHealth(html.port, '127.0.0.1', 1000, false)).toBeNull();

    const list = occupy(() => Response.json([{ service: 'kabmo' }]));
    expect(await fetchHealth(list.port, '127.0.0.1', 1000, false)).toBeNull();
  });

  test('returns null for a port nobody listens on, and for a bad port', async () => {
    expect(await fetchHealth(await freePort(), '127.0.0.1', 500)).toBeNull();
    expect(await fetchHealth(0, '127.0.0.1', 500)).toBeNull();
    expect(await fetchHealth(Number.NaN, '127.0.0.1', 500)).toBeNull();
  });

  test('a plaintext listener is not found over TLS, and the mode decides the scheme', async () => {
    const plain = occupy(() => Response.json({ service: 'kabmo', pid: process.pid }));

    expect(await fetchHealth(plain.port, '127.0.0.1', 1000, true)).toBeNull();
    expect(await fetchHealth(plain.port, '127.0.0.1', 1000, false)).not.toBeNull();
    // 'auto' cannot know which scheme a live instance chose, so it tries both.
    expect(await fetchHealth(plain.port, '127.0.0.1', 1000)).not.toBeNull();
  });
});
