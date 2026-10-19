/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Port occupancy probing.
 *
 * Availability is decided by *attempting a bind*, not by inspecting a PID file.
 * That matters on Bun: `Bun.serve` — and therefore Elysia's `listen`, which
 * hardcodes `reusePort: true` — lets a second process bind a port already in
 * use, so the only reliable question a starter can ask the OS is "can I bind
 * this?" (`net.createServer` never sets SO_REUSEPORT, so a second bind fails as
 * it should, regardless of who is already listening).
 */

import net from 'net';
import type { FdPressure } from '@/server/lib/lifecycle/fd-pressure';

const HEALTH_TIMEOUT_MS = 1500;

/**
 * Whether a payload's `fds` field is the shape `status` reads.
 *
 * A local guard rather than an import of the module that produces it: `probe.ts`
 * is loaded by the CLI, and `fd-pressure` `dlopen`s libc — pulling that into
 * every `kabmo status` would be a syscall surface the CLI does not need.
 * The type is imported as a TYPE only, so nothing of it survives to runtime.
 */
function isFdPressure(value: unknown): value is FdPressure {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.open === 'number'
    && typeof candidate.highest === 'number'
    && typeof candidate.limit === 'number'
    && typeof candidate.nearCliff === 'boolean'
  );
}

/**
 * Address a local probe should use for a bind host.
 *
 * `0.0.0.0`/`::` are bind-any addresses and cannot be connected to; loopback is
 * the address that reaches the same listener.
 */
export function probeHost(host?: string | null): string {
  const value = (host ?? '').trim();
  if (value.length === 0 || value === '0.0.0.0' || value === '::' || value === '[::]') return '127.0.0.1';
  return value;
}

/**
 * Whether a bind address is reachable only from this machine.
 *
 * Used to decide when to warn about an unauthenticated instance: loopback binds
 * are private by construction, while anything else (`0.0.0.0`, a LAN address, a
 * hostname) accepts connections from the network. An unrecognised value is
 * treated as exposed — the warning is worth a false positive, silence is not.
 */
export function isLoopbackHost(host?: string | null): boolean {
  const value = (host ?? '').trim().toLowerCase();
  if (value.length === 0) return true;
  if (value === 'localhost' || value === '::1' || value === '[::1]') return true;
  if (value === '0.0.0.0' || value === '::' || value === '[::]') return false;
  const ipv4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) return ipv4[1] === '127';
  return false;
}

/**
 * True when `port` can still be bound on `host`.
 *
 * The probe binds *the same address the server will bind* — a wildcard server
 * is probed with a wildcard bind. Probing loopback instead would ask a
 * different question: `net` sets SO_REUSEADDR, so a loopback bind can succeed
 * while `0.0.0.0:<port>` is already taken, and the port would look free right
 * up until the real `listen` failed.
 */
export async function isPortAvailable(port: number, host?: string | null): Promise<boolean> {
  if (!Number.isFinite(port) || port <= 0) return false;
  const bindHost = (host ?? '').trim() || 'localhost';
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const probe = net.createServer();
  probe.unref();
  probe.once('error', () => resolve(false));
  probe.listen({ port, host: bindHost }, () => {
    probe.close(() => resolve(true));
  });
  return await promise;
}

/** Poll until the port can be bound, or the deadline passes. */
export async function waitForPortFree(
  port: number,
  host: string | null | undefined,
  timeoutMs: number,
  intervalMs = 150,
): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  for (;;) {
    if (await isPortAvailable(port, host)) return true;
    if (Date.now() >= deadline) return false;
    await Bun.sleep(intervalMs);
  }
}

export interface HealthPayload {
  service: string;
  pid?: number;
  version?: string;
  startedAt?: string;
  uptime?: number;
  mock?: boolean;
  runtime?: string;
  mode?: string;
  port?: number;
  host?: string;
  /** Whether the listener speaks HTTPS. Reported by the server, never guessed. */
  tls?: boolean;
  /**
   * Whether the listener raises a tray icon. Read by the CLI when it restarts
   * an instance: the replacement is a fresh spawn, and this flag is the only
   * record of the icon the previous run had.
   */
  tray?: boolean;
  /** Whether a UI password is in force. Drives the `status` auth line. */
  authEnabled?: boolean;
  /**
   * Descriptor pressure, when the server could measure it. Must survive this
   * whitelist: `status` prints it as the warning that arrives BEFORE the
   * breakage, and dropping it here silently removed that line from every
   * report — the field was in the payload and read by the CLI, but never
   * carried across the probe.
   */
  fds?: FdPressure | null;
}

/**
 * One health request over `scheme`.
 *
 * `rejectUnauthorized: false` is required for the self-signed certificate this
 * project generates: the probe is asking "is a Kabmo server answering
 * here", and a certificate this machine generated for itself is not evidence
 * against that. It is safe here specifically because the caller is on the same
 * host and the answer is only used to identify a local process.
 */
async function probeHealthOver(
  scheme: 'http' | 'https',
  port: number,
  host: string,
  timeoutMs: number,
): Promise<HealthPayload | null> {
  try {
    const response = await fetch(`${scheme}://${host}:${port}/api/health`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      ...(scheme === 'https' ? { tls: { rejectUnauthorized: false } } : {}),
    } as RequestInit);
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object') return null;
    const payload = body as Record<string, unknown>;
    // Both names identify this product: a server started before the rename is
    // still running the old build and answers `ompchamber`, and `status`/`stop`
    // must find it — the alternative is a live instance nothing can report or
    // end. Normalized to the current name so every caller compares one value.
    if (payload.service !== 'kabmo' && payload.service !== 'ompchamber') return null;
    return {
      service: 'kabmo',
      pid: typeof payload.pid === 'number' ? payload.pid : undefined,
      version: typeof payload.version === 'string' ? payload.version : undefined,
      startedAt: typeof payload.startedAt === 'string' ? payload.startedAt : undefined,
      uptime: typeof payload.uptime === 'number' ? payload.uptime : undefined,
      mock: typeof payload.mock === 'boolean' ? payload.mock : undefined,
      runtime: typeof payload.runtime === 'string' ? payload.runtime : undefined,
      mode: typeof payload.mode === 'string' ? payload.mode : undefined,
      port: typeof payload.port === 'number' ? payload.port : undefined,
      host: typeof payload.host === 'string' ? payload.host : undefined,
      tls: typeof payload.tls === 'boolean' ? payload.tls : undefined,
      tray: typeof payload.tray === 'boolean' ? payload.tray : undefined,
      authEnabled: typeof payload.authEnabled === 'boolean' ? payload.authEnabled : undefined,
      fds: isFdPressure(payload.fds) ? payload.fds : null,
    };
  } catch {
    return null;
  }
}

/**
 * `GET /api/health` for a Kabmo listener, or null.
 *
 * Only payloads that identify themselves as Kabmo are returned — every
 * caller here is asking "is a Kabmo server on this port", so a foreign
 * HTTP service answers null rather than a half-trusted object.
 *
 * `tls: 'auto'` (the default) tries HTTPS first, then HTTP. Discovery cannot
 * know which a live instance chose, and the two are mutually exclusive on a port,
 * so one wasted request is the cheapest way to be right. A caller that DOES know
 * — the CLI that just spawned the server — passes `true` or `false` and pays one.
 */
export async function fetchHealth(
  port: number,
  host?: string | null,
  timeoutMs = HEALTH_TIMEOUT_MS,
  tls: boolean | 'auto' = 'auto',
): Promise<HealthPayload | null> {
  if (!Number.isFinite(port) || port <= 0) return null;
  const target = probeHost(host);
  if (tls === true) return probeHealthOver('https', port, target, timeoutMs);
  if (tls === false) return probeHealthOver('http', port, target, timeoutMs);

  const secure = await probeHealthOver('https', port, target, timeoutMs);
  return secure ?? probeHealthOver('http', port, target, timeoutMs);
}
