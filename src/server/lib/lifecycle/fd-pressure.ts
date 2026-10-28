/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * File-descriptor pressure, and the honest name for a spawn that dies from it.
 *
 * When the descriptor table is full, `posix_spawn` fails with a message that
 * names the shim it tried to exec — `EBADF: bad file descriptor, posix_spawn
 * '/bin/sh'` on macOS, `EMFILE: too many open files, socketpair` on Linux — and
 * says nothing about the cause. A terminal panel reads "Failed to start
 * /bin/zsh" while the real condition is that the whole server process has run
 * out of descriptors, so this module answers "how close?" and names the real
 * failure when it happens.
 *
 * A dev server reaches that state on its own, without a leak in this codebase:
 * `Bun.serve({ development: true })` holds the client module graph open, and a
 * macOS reload never releases the previous generation's (bun#40706, bun#40907 —
 * the pre-exec sweep exists only on Linux). Measured on this app: 13
 * descriptors on a freshly started server, 3354 after the first page load, and
 * never released. The ceiling it climbs toward is the kernel's own
 * (`getdtablesize()`: 61440 here), NOT Darwin's documented `OPEN_MAX` of 10240
 * — see `descriptorTableSize`, which is what makes `nearCliff` mean something.
 *
 * `countOpenFileDescriptors()` answers with `fcntl(F_GETFD)` over the table —
 * the same `bun:ffi` route `flock.ts` takes. It returns null where the symbols
 * are unavailable (and on Windows), and every caller must read null as
 * "unknown", never as "fine": `describeSpawnFailure` only names exhaustion when
 * it can see the pressure, so a genuine bad-descriptor bug still reports itself
 * plainly.
 */

import { dlopen, FFIType } from 'bun:ffi';
import type { FFIFunction, Library } from 'bun:ffi';

/**
 * Darwin's documented `OPEN_MAX`, kept only as the fallback for a host whose
 * table size cannot be read.
 *
 * It is NOT the live limit, and treating it as one is what let a real
 * exhaustion go unwarned. Measured on this machine: `getdtablesize()` answers
 * **61440** (`kern.maxfilesperproc`), so the process runs happily past 10240 —
 * while the probe capped at 10240 and reported "near the cliff" from 9216, a
 * warning that fired with six times the budget still free and then stayed on
 * forever. The ceiling that matters is the one the kernel reports, which is
 * what `descriptorTableSize` now returns.
 */
export const SPAWN_CLIFF = 10_240;

/**
 * Upper bound on the sweep, so the probe stays fast on a host with a huge table
 * (Linux commonly reports 1,048,576, and one `fcntl` per descriptor there would
 * be a fifth of a second on every health check). Measured: 61440 sweeps in
 * 12 ms, so this covers every real ceiling while keeping the cost bounded.
 *
 * When the table is larger than this, `open` is a LOWER BOUND and `nearCliff`
 * cannot be established — which is the honest answer, and why the cap is
 * documented here rather than silently clipping the number.
 */
const SWEEP_CAP = 65_536;

/**
 * Pressure is reported as "near" from 90% of the real ceiling. The remaining
 * tenth is what a burst of spawns needs (an omp child takes several), and the
 * failure arrives without a warning of its own: once the table is full there is
 * room for neither a retry nor a log line.
 */
const NEAR_CLIFF_RATIO = 0.9;

const FD_SYMBOLS = {
  fcntl: { args: [FFIType.i32, FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  getdtablesize: { args: [], returns: FFIType.i32 },
} satisfies Record<string, FFIFunction>;

/** Library names to try, in the order each platform resolves them. */
const LIBC_NAMES = ['libc.dylib', 'libSystem.B.dylib', 'libc.so.6'] as const;

/** `F_GETFD` — the cheapest question that distinguishes open from closed. */
const F_GETFD = 1;

declare global {
  // eslint-disable-next-line no-var
  var __kabmoFdLib: Library<typeof FD_SYMBOLS> | null | undefined;
}

/** libc with `fcntl`/`getdtablesize`, or null where this host has neither. */
function libc(): Library<typeof FD_SYMBOLS> | null {
  if (globalThis.__kabmoFdLib !== undefined) return globalThis.__kabmoFdLib;
  globalThis.__kabmoFdLib = null;
  if (process.platform === 'win32') return null;
  for (const name of LIBC_NAMES) {
    try {
      globalThis.__kabmoFdLib = dlopen(name, FD_SYMBOLS);
      return globalThis.__kabmoFdLib;
    } catch {
      // Try the next name; a host with none of them keeps the null answer.
    }
  }
  return null;
}

export interface FdPressure {
  /** Descriptors open below `limit`. */
  open: number;
  /** Highest descriptor number seen, or -1 when the table looked empty. */
  highest: number;
  /** Where the sweep stopped: `getdtablesize()`, capped at the cliff. */
  limit: number;
  /** Whether the next spawn is at risk. See `NEAR_CLIFF_RATIO`. */
  nearCliff: boolean;
}

/**
 * The kernel's descriptor table size for this process, or `SPAWN_CLIFF` when
 * the host cannot report one.
 *
 * `getdtablesize()` is the syscall that answers this on Darwin and Linux alike,
 * and it is the number the allocation path itself uses — so a limit read here
 * is the same one an `open` or a `posix_spawn` will hit. It is deliberately NOT
 * `ulimit -n`: on this machine the shell reports 1,048,576 while the kernel
 * refuses the 61441st descriptor, so the shell's number would understate the
 * pressure by a factor of seventeen.
 */
export function descriptorTableSize(): number {
  const symbols = libc();
  if (!symbols) return SPAWN_CLIFF;
  try {
    const reported = symbols.symbols.getdtablesize();
    return Number.isFinite(reported) && reported > 0 ? reported : SPAWN_CLIFF;
  } catch {
    return SPAWN_CLIFF;
  }
}

/**
 * Sweep the descriptor table, or null when this host cannot answer.
 *
 * Descriptors are allocated lowest-first, so the number of open descriptors and
 * the highest one agree on a saturated table — which is the only state that
 * matters here, and the state a dev server reaches by degrees.
 *
 * `limit` is the REAL ceiling (see `descriptorTableSize`), not a constant: the
 * whole point of this probe is to say how much room is left, and a limit that
 * disagrees with the kernel reports the wrong amount of it. On a host whose
 * table exceeds `SWEEP_CAP` the sweep stops at the cap, which makes `open` a
 * lower bound — read as "at least this many", never as the total.
 *
 * Never throws: `GET /api/health` is the CLI's readiness probe and the client's
 * liveness check, so a host where the symbol resolves but the call does not
 * must degrade to "unknown" rather than take those down.
 */
export function countOpenFileDescriptors(): FdPressure | null {
  const symbols = libc();
  if (!symbols) return null;

  try {
    const table = descriptorTableSize();
    const limit = Math.min(table, SWEEP_CAP);

    let open = 0;
    let highest = -1;
    for (let fd = 0; fd < limit; fd++) {
      if (symbols.symbols.fcntl(fd, F_GETFD, 0) !== -1) {
        open += 1;
        highest = fd;
      }
    }
    return { open, highest, limit, nearCliff: highest >= limit * NEAR_CLIFF_RATIO };
  } catch {
    return null;
  }
}

/**
 * What descriptor exhaustion looks like in Bun's own words. macOS names the
 * failing syscall (`EBADF … posix_spawn '/bin/sh'`), Linux the errno
 * (`EMFILE: too many open files, socketpair`) — measured on both.
 */
const EXHAUSTION_SYMPTOM = /\bEBADF\b|\bEMFILE\b|too many open files/i;

/**
 * The sentence that names descriptor exhaustion, or null when there is none to
 * name. Every caller that would otherwise blame the operation it was running
 * needs this: a truncated table makes a bundle, a spawn and a plain file read
 * fail identically, and the operation's own message never carries the cause.
 */
export function describeFdPressure(pressure = countOpenFileDescriptors()): string | null {
  if (!pressure || !pressure.nearCliff) return null;
  return (
    `The Kabmo server is out of file descriptors ` +
    `(${pressure.open} of ${pressure.limit} open, highest #${pressure.highest}); restart the instance. ` +
    `A dev server holds the whole client module graph open and a macOS reload never releases ` +
    `the previous generation (bun#40706), so the count only climbs.`
  );
}

/**
 * What a burst of spawns needs, kept free at all times.
 *
 * A terminal PTY, an omp child and `git`/`rg` can all be asked for at once, and
 * once the table is full the failure arrives without a warning of its own:
 * there is room for neither a retry nor a log line.
 */
const MIN_SPAWN_HEADROOM = 1_024;

/**
 * Whether `cost` more descriptors can be opened without walking into the cliff.
 *
 * This is the difference between a hard stop and a cascade. When the table is
 * nearly full, an operation that needs thousands of descriptors — a client
 * bundle, whose graph a dev server then HOLDS — does not merely fail: it fails
 * partway, and the failure is what the reader sees instead of the cause. Asking
 * first turns that into one honest answer.
 *
 * `null` (the host cannot answer) returns true: refusing work on a guess would
 * break every host where the probe is unavailable, and the cost of being wrong
 * is the failure we already had.
 */
export function hasDescriptorHeadroom(pressure: FdPressure | null, cost: number): boolean {
  if (!pressure) return true;
  return pressure.open + cost + MIN_SPAWN_HEADROOM <= pressure.limit;
}

/**
 * The message to surface for a failed spawn: Bun's own, plus what it takes to
 * act on it when the cause is descriptor exhaustion.
 *
 * Two conditions, both required. The message must carry the symptom, and the
 * sweep must see real pressure — a truncated table is not the only way `EBADF`
 * reaches here, and appending "out of descriptors" to a genuine bad-descriptor
 * bug (or to an unrelated `ENOENT` that failed while the table happened to be
 * full) sends the next reader down the wrong path.
 */
export function describeSpawnFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (!EXHAUSTION_SYMPTOM.test(raw)) return raw;
  const pressure = describeFdPressure();
  return pressure ? `${raw} — ${pressure}` : raw;
}
