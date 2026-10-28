/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The ADDRESS RULES `probe.ts` applies before it asks anything: which address a
 * bind host stands for, and whether that address can be bound.
 *
 * Getting either wrong is expensive — a false "free" turns into an EADDRINUSE
 * after the server has already announced itself, and a false "occupied" blocks
 * startup on a port nobody holds — so the cases drive real listeners on
 * OS-assigned ports and pin the translation that decides which address is asked
 * about in the first place. The health half of the module is `probe-health`.
 */

import { afterAll, describe, expect, test } from 'bun:test';

import {
  connectAddresses,
  isLoopbackHost,
  isPortAvailable,
  probeAddresses,
  probeHost,
  unavailableAddresses,
  waitForPortFree,
} from '@/server/lib/lifecycle/probe';
import { createLoopbackHarness, ipv6Loopback } from '@/test-support/loopback';

const harness = createLoopbackHarness();
const { occupy, occupyAt, freePort, freePortBothFamilies } = harness;

afterAll(async () => {
  await harness.dispose();
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

describe('probeAddresses', () => {
  test('a loopback name is every loopback family, because a bind picks one', () => {
    // Measured: `Bun.serve({ hostname: 'localhost' })` listens on `[::1]` alone.
    // Asking only about that family is how a stale instance kept `127.0.0.1`
    // while the newcomer's own log reported the port free.
    expect(probeAddresses('localhost')).toEqual(['127.0.0.1', '::1']);
    expect(probeAddresses('LOCALHOST')).toEqual(['127.0.0.1', '::1']);
    expect(probeAddresses(undefined)).toEqual(['127.0.0.1', '::1']);
    expect(probeAddresses('  ')).toEqual(['127.0.0.1', '::1']);
  });

  test('a literal address is one address', () => {
    expect(probeAddresses('127.0.0.1')).toEqual(['127.0.0.1']);
    expect(probeAddresses('0.0.0.0')).toEqual(['0.0.0.0']);
    expect(probeAddresses('192.168.1.4')).toEqual(['192.168.1.4']);
  });

  test('connect addresses translate a bind-any address, and keep the rest', () => {
    expect(connectAddresses('0.0.0.0')).toEqual(['127.0.0.1']);
    expect(connectAddresses('::')).toEqual(['127.0.0.1']);
    expect(connectAddresses('localhost')).toEqual(['127.0.0.1', '::1']);
    expect(connectAddresses('192.168.1.4')).toEqual(['192.168.1.4']);
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

    const wildcard = occupy(() => new Response('held'), '0.0.0.0');
    expect(await isPortAvailable(wildcard.port, '0.0.0.0')).toBe(false);
    wildcard.server.stop(true);

    // The listener that held the port is gone, so the same question flips.
    expect(await waitForPortFree(loopback.port, '127.0.0.1', 2_000, 25)).toBe(true);
    expect(await isPortAvailable(loopback.port, '127.0.0.1')).toBe(true);
  });

  test('refuses a nonsensical port without touching the network', async () => {
    expect(await isPortAvailable(0, '127.0.0.1')).toBe(false);
    expect(await isPortAvailable(-1, '127.0.0.1')).toBe(false);
    expect(await isPortAvailable(Number.NaN, '127.0.0.1')).toBe(false);
  });

  test.skipIf(!ipv6Loopback)('a name is busy when only ONE of its addresses is held', async () => {
    // The reported failure, reduced: a stale instance holds `127.0.0.1:3000`,
    // `bun run dev` binds `localhost` (i.e. `::1`) and finds that family free.
    // Both servers then serve "port 3000" and the browser lands on whichever
    // family it resolves — the stale one, in a different data mode.
    const shared = await freePortBothFamilies();
    const stale = occupyAt(shared, '127.0.0.1');
    expect(await isPortAvailable(shared, 'localhost')).toBe(false);
    expect(await unavailableAddresses(shared, 'localhost')).toEqual(['127.0.0.1']);
    stale.stop(true);
    expect(await waitForPortFree(shared, 'localhost', 2_000, 25)).toBe(true);

    // The other family alone is just as busy.
    const other = await freePortBothFamilies();
    const v6 = occupyAt(other, '::1');
    expect(await isPortAvailable(other, 'localhost')).toBe(false);
    expect(await unavailableAddresses(other, 'localhost')).toEqual(['::1']);
    v6.stop(true);
  });

  test('reports the address that is held, and none when the port is free', async () => {
    const free = await freePort();
    expect(await unavailableAddresses(free, '127.0.0.1')).toEqual([]);
    expect(await unavailableAddresses(free, 'localhost')).toEqual([]);

    const held = occupy(() => new Response('held'));
    expect(await unavailableAddresses(held.port, '127.0.0.1')).toEqual(['127.0.0.1']);
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
