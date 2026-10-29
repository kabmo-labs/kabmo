/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Whether the serving process has finished loading its plugin halves.
 *
 * A restart is recognised by `GET /api/health` answering with a different
 * `pid`/`startedAt`, and the console reloads on that — but the listener answers
 * health BEFORE the boot's plugin pass runs (`src/server/index.ts` serves first,
 * then syncs bundled plugins, then imports every server half). So the reload
 * lands in a server whose plugin RPCs still 404, which the kit reports as
 * `plugin_not_loaded`.
 *
 * Measured after a restart: the Stats header's `watch` fired 194 ms into the new
 * page, 404'd, and its effect — keyed on the call's identity — never ran again.
 * The readout stayed on `—` until a manual reload, though the halves were up
 * ~500 ms later. That is a race, not a plugin fault, so the reader has to be
 * able to tell "not loaded YET" from "not loaded" and retry only the first.
 *
 * **Only a positive "still booting" answer is waited on.** A health request that
 * fails, or that answers without the field (an older server), is not evidence of
 * a boot window — waiting on it would put a 15-second stall in front of every
 * plugin call on a server that simply cannot be asked.
 */

/** How often the boot window is polled while the server says it is booting. */
const READY_POLL_MS = 250;

/**
 * Ceiling on the wait. The plugin pass is a handful of module imports after the
 * listener is up, so anything past this is a plugin that failed to load — and
 * its own failure is reported by `GET /api/plugins` rather than by a retry.
 */
export const PLUGIN_READY_TIMEOUT_MS = 15_000;

/** What one health read says about the plugin platform. */
type Readiness = 'ready' | 'booting' | 'unknown';

/**
 * What the wait concluded, and it is three answers rather than a boolean
 * because only ONE of them licenses a retry.
 *
 * - `ready` — the platform was already up. A 404 here is the plugin genuinely
 *   not being loaded, and retrying it would only double a call that is correct.
 * - `booted` — a boot window was observed and it FINISHED during the wait. The
 *   call that landed in it deserves its retry.
 * - `unavailable` — the server could not be asked, or was still booting when the
 *   ceiling passed. The caller reports its own failure.
 */
export type PluginPlatformWait = 'ready' | 'booted' | 'unavailable';

let ready = false;

/** Whether this wait ever saw the server say "still booting". */
let observedBooting = false;

/** A test seam: forget the cached answer. */
export function resetPluginReadiness(): void {
  ready = false;
  observedBooting = false;
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/** One read of the flag. */
async function readReadiness(): Promise<Readiness> {
  try {
    const response = await fetch('/api/health', {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return 'unknown';
    const payload = (await response.json()) as { pluginsReady?: unknown } | null;
    if (payload?.pluginsReady === false) return 'booting';
    return 'ready';
  } catch {
    // No answer at all: the server is starting, gone, or behind a network fault.
    // None of those is the boot window this exists for.
    return 'unknown';
  }
}

/**
 * Wait out a boot window that is in progress, and say which case it was.
 *
 * `ready` immediately when the platform is already up — the common case, and the
 * one that must not cost a request — and `unavailable` for both "the server says
 * it is still booting and did not finish in time" and "the server cannot be
 * asked". Only `booted` means a call that landed inside the window and is worth
 * repeating.
 */
export async function awaitPluginPlatformReady(
  /**
   * Ceiling for this wait. A seam because the case that matters — a boot that
   * never finishes, so the caller reports its own failure — cannot be produced
   * on demand by a live server without a 15-second test.
   */
  timeoutMs: number = PLUGIN_READY_TIMEOUT_MS,
): Promise<PluginPlatformWait> {
  if (ready) return 'ready';
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const answer = await readReadiness();
    if (answer === 'ready') {
      // A boot window WAS observed before this answer, or the platform was
      // already up when the first read ran. The difference is whether the caller
      // is looking at a call that landed inside the window.
      const booted = observedBooting;
      ready = true;
      return booted ? 'booted' : 'ready';
    }
    // Not the boot window: nothing to wait for, and the caller's own answer is
    // the honest one.
    if (answer === 'unknown') return 'unavailable';
    observedBooting = true;
    if (Date.now() >= deadline) return 'unavailable';
    await sleep(READY_POLL_MS);
  }
}
