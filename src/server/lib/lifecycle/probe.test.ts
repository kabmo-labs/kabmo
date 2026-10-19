/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `probe.ts` answers two questions a starting server depends on: "can I bind
 * this address" and "is a Kabmo server answering here". Getting either
 * wrong is expensive — a false "free" turns into an EADDRINUSE after the
 * server has already announced itself, and a false "occupied" blocks startup
 * on a port nobody holds — so the tests drive real listeners on ephemeral
 * ports (never a fixed one) and real HTTP stubs, and pin the address
 * translation rules that decide which address is asked about in the first
 * place.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Server } from 'bun';

import { fetchHealth, isLoopbackHost, isPortAvailable, probeHost, waitForPortFree } from '@/server/lib/lifecycle/probe';

const servers: Server<undefined>[] = [];

/** A live listener on an OS-assigned port; the port number is the test's. The
 *  pair shape keeps `server.port` (`number | undefined` in Bun's types) out
 *  of every call site. */
function occupy(fetch: (request: Request) => Response | Promise<Response>, hostname = '127.0.0.1'): { server: Server<undefined>; port: number } {
  const server = Bun.serve({ port: 0, hostname, fetch }) as Server<undefined>;
  const port = server.port;
  if (port === undefined) throw new Error('the OS did not assign an ephemeral port');
  servers.push(server);
  return { server, port };
}

/**
 * A port that nothing holds: take one from the OS, give it back, and wait for
 * the release to actually land — Bun closes a stopped listener's socket on a
 * later event-loop turn, so an immediate check would be a race, not a test.
 */
async function freePort(): Promise<number> {
  const held = occupy(() => new Response('unused'));
  held.server.stop(true);
  servers.splice(servers.indexOf(held.server), 1);
  if (!(await waitForPortFree(held.port, '127.0.0.1', 2_000, 25))) {
    throw new Error(`ephemeral port ${held.port} never became free`);
  }
  return held.port;
}

/**
 * The runner's own fetch, captured before any test runs. Another file in the
 * same `bun test` process may have left a stub installed on the global, and
 * every case here talks to a REAL listener it just started on loopback — so
 * the global is put back before each one rather than trusting the ambient one.
 */
/** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const realFetch = Bun.fetch;

beforeEach(() => {
  globalThis.fetch = realFetch;
});

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

describe('probeHost', () => {
  test('turns a bind-any address into the loopback a probe can connect to', () => {
    // Connecting to `0.0.0.0` is not a thing; loopback reaches the same listener.
    expect(probeHost('0.0.0.0')).toBe('127.0.0.1');
    expect(probeHost('::')).toBe('127.0.0.1');
    expect(probeHost('[::]')).toBe('127.0.0.1');
    expect(probeHost(undefined)).toBe('127.0.0.1');
    expect(probeHost(null)).toBe('127.0.0.1');
    expect(probeHost('   ')).toBe('127.0.0.1');
  });

  test('passes a real address through, trimmed', () => {
    expect(probeHost('localhost')).toBe('localhost');
    expect(probeHost(' 192.168.1.4 ')).toBe('192.168.1.4');
    expect(probeHost('127.0.0.1')).toBe('127.0.0.1');
  });
});

describe('isLoopbackHost', () => {
  test('treats an unset address as private', () => {
    expect(isLoopbackHost(undefined)).toBe(true);
    expect(isLoopbackHost(null)).toBe(true);
    expect(isLoopbackHost('')).toBe(true);
  });

  test('recognizes every loopback spelling, case-insensitively', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('LOCALHOST')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('127.9.8.7')).toBe(true);
  });

  test('reports anything reachable from the network as exposed', () => {
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(isLoopbackHost('::')).toBe(false);
    expect(isLoopbackHost('[::]')).toBe(false);
    expect(isLoopbackHost('192.168.1.4')).toBe(false);
    expect(isLoopbackHost('128.0.0.1')).toBe(false);
    expect(isLoopbackHost('chamber.example')).toBe(false);
    // Four digits in the first octet is not an IPv4 literal, so it falls
    // through to the "unrecognized means exposed" branch.
    expect(isLoopbackHost('1270.0.0.1')).toBe(false);
  });
});

describe('isPortAvailable', () => {
  test('reports a free port free and an occupied one busy', async () => {
    const port = await freePort();
    expect(await isPortAvailable(port, '127.0.0.1')).toBe(true);

    const { server: held, port: heldPort } = occupy(() => new Response('held'));
    expect(await isPortAvailable(heldPort, '127.0.0.1')).toBe(false);
    // Probing the same address must not disturb the listener it asked about.
    expect(await isPortAvailable(heldPort, '127.0.0.1')).toBe(false);

    held.stop(true);
    servers.splice(servers.indexOf(held), 1);
    // An ephemeral port is released once the listener closes; the poll is what
    // callers use to wait for exactly that.
    expect(await waitForPortFree(heldPort, '127.0.0.1', 2_000, 25)).toBe(true);
    expect(await isPortAvailable(heldPort, '127.0.0.1')).toBe(true);
  });

  test('probes the address the server will bind, not the one that is easier', async () => {
    // A probe that answers about a fixed `localhost` is the false negative that
    // turns a clean startup into an EADDRINUSE, so the answer must be about the
    // address it was given.
    const loopback = occupy(() => new Response('held'));
    expect(await isPortAvailable(loopback.port, '127.0.0.1')).toBe(false);
    // A CROSS-address probe is the platform's answer, not a rule of ours: macOS
    // lets a wildcard bind coexist with the loopback listener (reads free),
    // Linux refuses it (reads busy). Neither is pinned — both are honest
    // answers about the address asked for.
    loopback.server.stop(true);
    servers.splice(servers.indexOf(loopback.server), 1);

    const wildcard = occupy(() => new Response('held'), '0.0.0.0');
    expect(await isPortAvailable(wildcard.port, '0.0.0.0')).toBe(false);
    wildcard.server.stop(true);
    servers.splice(servers.indexOf(wildcard.server), 1);

    // The listener that held the port is gone, so the same question flips.
    expect(await waitForPortFree(loopback.port, '127.0.0.1', 2_000, 25)).toBe(true);
    expect(await isPortAvailable(loopback.port, '127.0.0.1')).toBe(true);
  });

  test('refuses a nonsensical port without touching the network', async () => {
    expect(await isPortAvailable(0, '127.0.0.1')).toBe(false);
    expect(await isPortAvailable(-1, '127.0.0.1')).toBe(false);
    expect(await isPortAvailable(Number.NaN, '127.0.0.1')).toBe(false);
  });
});

describe('waitForPortFree', () => {
  test('returns immediately when the port is free', async () => {
    expect(await waitForPortFree(await freePort(), '127.0.0.1', 0)).toBe(true);
  });

  test('gives up at the deadline instead of hanging on a held port', async () => {
    const held = occupy(() => new Response('held'));
    expect(await waitForPortFree(held.port, '127.0.0.1', 0)).toBe(false);
  });
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
