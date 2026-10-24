/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Real loopback listeners and real processes for the lifecycle suites.
 *
 * `probe`, `claimPort` and `findOccupant` all answer questions about sockets
 * and PIDs, so a double would test the double: every case here drives actual
 * listeners on OS-assigned ports and actual processes. The harness exists
 * because those suites are split by subject (the address rules, the health
 * probe, the lock, the claim) and each needs the same six fixtures — a copy per
 * file is how one of them quietly stops covering both loopback families.
 *
 * Two properties are load-bearing:
 *
 *  - `localhost` is TWO addresses. A fixture that holds one family and expects
 *    the other to read free must first find a port free on both, because the OS
 *    assigns per family.
 *  - A live PID that is not ours is what a test about ANOTHER instance needs:
 *    the guard reads a listener reporting `process.pid` as this very process
 *    re-binding (the `bun run --hot` case), which is the opposite of a refusal.
 */

import { expect } from 'bun:test';
import type { Server } from 'bun';
import net from 'node:net';

import { getProcessState } from '@/server/lib/lifecycle/identity';
import { isPortAvailable, waitForPortFree } from '@/server/lib/lifecycle/probe';

/**
 * The runner's own fetch, reached through `Bun` so a stub another file left on
 * the global cannot be mistaken for it. Every case here talks to a real
 * listener, and `findOccupant` asks one over `fetch`.
 */
export const realFetch = Bun.fetch;

async function probeIpv6Loopback(): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const probe = net.createServer();
  probe.once('error', () => resolve(false));
  probe.listen({ port: 0, host: '::1' }, () => {
    probe.close(() => resolve(true));
  });
  return await promise;
}

/**
 * Whether this host has a usable IPv6 loopback.
 *
 * A kernel booted without IPv6 answers `EADDRNOTAVAIL` for `::1`, where a
 * case about the two addresses of `localhost` cannot observe anything at all.
 * Skipped BY NAME rather than weakened: an assertion that silently holds on one
 * family would pass while the bug was live.
 */
export const ipv6Loopback = await probeIpv6Loopback();

export interface LoopbackHarness {
  /** A live listener on an OS-assigned port, plus the number it got. */
  occupy(
    fetch: (request: Request) => Response | Promise<Response>,
    hostname?: string,
  ): { server: Server<undefined>; port: number };
  /** A live listener on a specific port and address. */
  occupyAt(port: number, hostname: string, fetch?: (request: Request) => Response): Server<undefined>;
  /** An OS-assigned port, released and confirmed free. */
  freePort(): Promise<number>;
  /** An OS-assigned port free on BOTH loopback families. */
  freePortBothFamilies(): Promise<number>;
  /** A live process that is not this one; killed by `dispose`. */
  livePid(): Promise<number>;
  /** A real process whose argv says `kabmo`, i.e. `matched` to identity.ts. */
  spawnChamberHolder(): Promise<Bun.Subprocess>;
  /** A PID that has exited and been reaped, so it reads as `dead`. */
  deadPid(): Promise<number>;
  /** Stop every listener and kill every child this harness started. */
  dispose(): Promise<void>;
}

export function createLoopbackHarness(): LoopbackHarness {
  const servers: Server<undefined>[] = [];
  const children: Bun.Subprocess[] = [];

  function occupy(
    fetch: (request: Request) => Response | Promise<Response>,
    hostname = '127.0.0.1',
  ): { server: Server<undefined>; port: number } {
    const server = Bun.serve({ port: 0, hostname, fetch }) as Server<undefined>;
    const port = server.port;
    if (port === undefined) throw new Error('the OS did not assign an ephemeral port');
    servers.push(server);
    return { server, port };
  }

  function occupyAt(
    port: number,
    hostname: string,
    fetch: (request: Request) => Response = () => new Response('held'),
  ): Server<undefined> {
    const server = Bun.serve({ port, hostname, fetch }) as Server<undefined>;
    servers.push(server);
    return server;
  }

  function forget(server: Server<undefined>): void {
    const index = servers.indexOf(server);
    if (index >= 0) servers.splice(index, 1);
  }

  async function freePort(): Promise<number> {
    // Bun closes a stopped listener's socket on a later event-loop turn, so an
    // immediate check would be a race, not a test.
    const held = occupy(() => new Response('unused'));
    held.server.stop(true);
    forget(held.server);
    if (!(await waitForPortFree(held.port, '127.0.0.1', 2_000, 25))) {
      throw new Error(`ephemeral port ${held.port} never became free`);
    }
    return held.port;
  }

  async function freePortBothFamilies(): Promise<number> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = await freePort();
      if (await isPortAvailable(candidate, '::1')) return candidate;
    }
    throw new Error('the OS handed out no ephemeral port free on both loopback families');
  }

  async function livePid(): Promise<number> {
    const child = Bun.spawn({
      cmd: ['bun', '-e', 'await new Promise(() => {})'],
      stdout: 'ignore',
      stderr: 'ignore',
    });
    children.push(child);
    return child.pid;
  }

  async function spawnChamberHolder(): Promise<Bun.Subprocess> {
    // The child announces itself before it parks, and that line is what says the
    // OS has finished `exec`: a freshly spawned process's command line is
    // unreadable for the instant between fork and exec, so Linux's probe falls
    // back to `comm` and identity answers `mismatched` for a process that IS
    // ours. Production reads a PID out of a lock file written long before, so it
    // never sees that window — no fixed delay to guess at here.
    const child = Bun.spawn({
      cmd: ['bun', '-e', 'console.log("ready"); await new Promise(() => {})', 'kabmo-holder'],
      stdout: 'pipe',
      stderr: 'ignore',
    });
    children.push(child);
    const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    reader.releaseLock();
    expect(getProcessState(child.pid)).toBe('matched');
    return child;
  }

  async function deadPid(): Promise<number> {
    const child = Bun.spawn({ cmd: ['bun', '-e', 'process.exit(0)'], stdout: 'ignore', stderr: 'ignore' });
    const pid = child.pid;
    await child.exited;
    expect(getProcessState(pid)).toBe('dead');
    return pid;
  }

  async function dispose(): Promise<void> {
    for (const child of children.splice(0)) {
      try {
        child.kill('SIGKILL');
        await child.exited;
      } catch {
        // Already gone.
      }
    }
    for (const server of servers.splice(0)) server.stop(true);
  }

  return { occupy, occupyAt, freePort, freePortBothFamilies, livePid, spawnChamberHolder, deadPid, dispose };
}
