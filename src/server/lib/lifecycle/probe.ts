/**
 * @license
 * SPDX-License-Identifier: MIT
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
 * Addresses a bind to `host` can land on.
 *
 * A NAME is not one address, and that is the whole bug this function exists
 * for. `localhost` resolves to both loopback families, while Bun binds only the
 * one it resolves first — verified: `Bun.serve({ hostname: 'localhost' })`
 * listens on `[::1]` alone. Asking about that family alone answers "is the
 * socket I am about to open free", which is not the question a port guard
 * exists to answer: the other address stays available to a second server, and a
 * client that resolves THAT one reaches it. Measured on a real dev run against a
 * stale instance on `127.0.0.1:3000`: both servers reported the port as theirs,
 * the browser landed on the old build (a MOCK instance), and the newcomer's own
 * log said the port was free.
 *
 * A literal address and a bind-any address are one address by definition. An
 * arbitrary hostname is deliberately left alone: its resolution belongs to the
 * OS, a second lookup here could disagree with the one the bind will use, and
 * only loopback is guaranteed multi-family on every host.
 */
export function probeAddresses(host?: string | null): string[] {
  const value = (host ?? '').trim();
  if (value.length === 0 || value.toLowerCase() === 'localhost') return ['127.0.0.1', '::1'];
  return [value];
}

/**
 * Addresses a health request should be sent to, for a bind host.
 *
 * The same list as `probeAddresses`, with bind-any addresses translated to the
 * loopback that reaches them. Kept separate because the two questions differ:
 * occupancy is asked with a BIND (so `0.0.0.0` is a legitimate address to bind)
 * while identification is asked with a CONNECT (where `0.0.0.0` is not an
 * address at all).
 */
export function connectAddresses(host?: string | null): string[] {
  return probeAddresses(host).map(probeHost);
}

/**
 * Bind failures that mean "this host has no such address", not "someone holds
 * it": a kernel booted without IPv6 answers `EADDRNOTAVAIL` for `::1`, and
 * reading that as occupied would refuse every start on that machine.
 */
const ABSENT_ADDRESS_CODES: Record<string, true> = {
  EADDRNOTAVAIL: true,
  EAFNOSUPPORT: true,
};

/** Whether one address can be bound. */
async function bindable(port: number, host: string): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const probe = net.createServer();
  probe.unref();
  probe.once('error', (error: NodeJS.ErrnoException) => {
    resolve(ABSENT_ADDRESS_CODES[error.code ?? ''] === true);
  });
  probe.listen({ port, host }, () => {
    probe.close(() => resolve(true));
  });
  return await promise;
}

/**
 * Every address of `host` where `port` is already taken; empty means free.
 *
 * The list rather than a boolean, because the guard's failure message has to
 * name the address that is held — "port busy" on a name that resolves to two
 * addresses does not say which one the user has to free.
 */
export async function unavailableAddresses(port: number, host?: string | null): Promise<string[]> {
  if (!Number.isFinite(port) || port <= 0) return [];
  const blocked: string[] = [];
  for (const address of probeAddresses(host)) {
    if (!(await bindable(port, address))) blocked.push(address);
  }
  return blocked;
}

/**
 * True when `port` can still be bound on `host`.
 *
 * The probe binds *the same addresses the server will bind* — a wildcard server
 * is probed with a wildcard bind, and a name is probed on every address it
 * resolves to. Probing loopback instead of a wildcard would ask a different
 * question: `net` sets SO_REUSEADDR, so a loopback bind can succeed while
 * `0.0.0.0:<port>` is already taken, and the port would look free right up
 * until the real `listen` failed. Probing one family of a name asks a narrower
 * question still: whether *this* socket is free, when the answer that matters
 * is whether the port is free for the name a browser will type.
 */
export async function isPortAvailable(port: number, host?: string | null): Promise<boolean> {
  if (!Number.isFinite(port) || port <= 0) return false;
  return (await unavailableAddresses(port, host)).length === 0;
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
 * A host as a URL authority.
 *
 * An IPv6 literal has to be bracketed: `http://::1:3000/api/health` is not a
 * URL, and the failure is a throw rather than a connection attempt — so asking
 * `::1` without this reads as "nothing there", which is the same silent answer
 * the multi-address probe exists to stop. `localhost` never reaches this branch
 * (no colon), and an already-bracketed address is left alone.
 */
function urlAuthority(host: string): string {
  if (host.startsWith('[') || !host.includes(':')) return host;
  return `[${host}]`;
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
    const response = await fetch(`${scheme}://${urlAuthority(host)}:${port}/api/health`, {
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
 * A NAME is asked on every address it resolves to, concurrently, and the first
 * answer wins. A single-address request is the false negative that made a live
 * instance invisible to `status` and `stop`: `localhost` resolves to both
 * loopback families, a server binds only one of them, and a request aimed at the
 * other reaches nothing — so a MOCK instance holding `127.0.0.1:3000` answered
 * no CLI command while the browser kept landing on it. Concurrent rather than
 * sequential because a port nobody serves must not cost one timeout per family,
 * and ECONNREFUSED on the family with no listener returns immediately.
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
  const answers = await Promise.all(
    connectAddresses(host).map((target) => probeHealthOn(port, target, timeoutMs, tls)),
  );
  return answers.find((answer) => answer !== null) ?? null;
}

/** One address, in whichever scheme the caller allows. */
async function probeHealthOn(
  port: number,
  target: string,
  timeoutMs: number,
  tls: boolean | 'auto',
): Promise<HealthPayload | null> {
  if (tls === true) return probeHealthOver('https', port, target, timeoutMs);
  if (tls === false) return probeHealthOver('http', port, target, timeoutMs);

  const secure = await probeHealthOver('https', port, target, timeoutMs);
  return secure ?? probeHealthOver('http', port, target, timeoutMs);
}
