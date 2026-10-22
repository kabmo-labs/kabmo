/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `--config` overlay that points a session's TITLE generation at the model
 * the session itself runs.
 *
 * ## Why this exists
 *
 * omp's `/rename` names a session with its `tiny` ROLE model — `getTitleModels`
 * → `roleCandidatePool("tiny")` — and only ever appends the session's OWN model
 * when `retry.modelFallback` is on (`title-generator.ts`:
 * `cfgRetryModelFallback.get(settings) !== false`). On this install the role
 * resolved to `kenari/deepseek-v4-flash`, whose plan had expired, so every
 * rename waited out the provider timeout and answered "Could not generate a
 * session title" — while the conversation's own model
 * (`kenari-jatis/deepseek-v4-1-flash`) served the same request fine. Measured
 * against a real child: the failing path answered at 53s, the session's own
 * model answered in ~7s with a real title.
 *
 * ## How it reaches a child that is already running
 *
 * A session's child is spawned long before a rename is requested, and no RPC
 * verb changes a role. The overlay is therefore written as a FILE and handed to
 * every spawn with `--config` (`buildSessionSpawnArgs`), and omp WATCHES that
 * path — `Settings.#configWatchTargets` includes `#configFiles`, reload debounced
 * `CONFIG_WATCH_DEBOUNCE_MS` (200ms). Verified live: rewriting the overlay under
 * a running child changed the role its next `/rename` used, no restart.
 *
 * Two properties are load-bearing and both were verified:
 *
 *   - **The file is created at spawn with an empty mapping (`{}`) and never
 *     deleted.** omp's overlay loader is STRICT — a missing or malformed file is
 *     a hard error (`#loadOverlayYaml`) — so a child watching a deleted path
 *     would break its settings on the next reload. Every write is therefore a
 *     whole-file replacement, and "no override" is `{}`, not absence.
 *   - **Only `modelRoles.tiny` is ever written.** An overlay is deep-merged over
 *     the user's config, so the other roles keep their values; the file carries
 *     nothing else.
 *
 * ## The settle wait
 *
 * The reload is a filesystem event plus a debounce, so there is no frame to
 * await — omp exposes no RPC verb for its roles, and its reload emits nothing on
 * the wire. `withTitleModelOverride` therefore waits out the debounce (plus a
 * margin) before dispatching. That is a real wait on an external process's
 * documented timing, not a guess: the debounce is a published constant, and the
 * reload itself is one file read.
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { getAgentDir } from '@/server/lib/omp/core/paths';
import { writeFileAtomic } from '@/server/lib/fs/atomic-write';

/** Overlay file name, under the agent dir. A STABLE name is load-bearing: a
 *  fresh path per request would leave the previous one watched and dead, and
 *  the child would never see the change. */
const OVERLAY_NAME = 'kabmo-title-model.yml';

/**
 * How long to let omp apply a rewritten overlay before dispatching `/rename`.
 *
 * omp's config watcher debounces at 200ms (`CONFIG_WATCH_DEBOUNCE_MS`) and the
 * reload behind it is one file read and a merge. The margin is deliberate: a
 * rename that raced the reload would be named by the role the user configured —
 * the exact bug this override exists to fix — and a few hundred extra
 * milliseconds on a user-initiated action is invisible next to the seconds the
 * generation itself takes.
 */
const OVERLAY_SETTLE_MS = 400;

/** Absolute path of the overlay every session child is told to load. */
export function titleModelOverlayPath(): string {
  return join(getAgentDir(), OVERLAY_NAME);
}

/** An overlay with no override. Valid YAML, and a no-op merge. */
const EMPTY_OVERLAY = '{}\n';

/**
 * Ensure the overlay exists before a child is spawned with `--config`.
 *
 * Synchronous on purpose: it runs in the spawn path, where the argv is built
 * and handed to `Bun.spawn` immediately, and the file must exist before the
 * child reads it — a missing overlay is a hard error in omp, not a fallback.
 * `existsSync` keeps it to one stat per spawn, and an EXISTING file is never
 * touched: a rename in flight owns its content.
 *
 * The agent dir is created first. It normally exists because omp wrote it, but
 * nothing guarantees that: on a fresh machine, in a container, or on a CI
 * runner where omp was installed and never run, `~/.omp/agent` is absent and
 * the bare write threw ENOENT — swallowed, leaving no overlay behind. Every
 * spawn then named a `--config` path that did not exist, which omp answers with
 * `Config overlay not found` and no session at all. Verified: Kabmo's own
 * `constants.test.ts` fails on a clean `PI_CODING_AGENT_DIR`, and passes once
 * the parent is created.
 */
export function ensureTitleModelOverlay(): void {
  const path = titleModelOverlayPath();
  if (existsSync(path)) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, EMPTY_OVERLAY, { mode: 0o600 });
  } catch {
    // An unwritable agent dir leaves no overlay, and the spawn then fails on a
    // missing `--config` file — but that is omp's own error to report, and it
    // names the path. Swallowing here keeps the spawn path from throwing a
    // second, less useful error over it.
  }
}

/** Replace the overlay's whole content. The selector is quoted so a `#` or `:`
 *  inside a model id cannot change the YAML parse. */
async function writeOverlay(selector: string | undefined): Promise<void> {
  const body = selector ? `modelRoles:\n  tiny: ${JSON.stringify(selector)}\n` : EMPTY_OVERLAY;
  await writeFileAtomic(titleModelOverlayPath(), body, { createMode: 0o600 });
}

/**
 * Holders of the pin, and the selector each asked for.
 *
 * The overlay is ONE file for every session, so a pin cannot be "owned" by one
 * request while another waits: a title model can take a minute, and queueing
 * the second request behind the first would make the operator's next prompt
 * wait on a generation it has nothing to do with. Instead the pin is
 * NEWEST-WINS — every holder is recorded, the file always carries the most
 * recent selector, and the file is cleared only when the last holder leaves.
 * A request that is superseded mid-generation is one omp cancels anyway
 * (`renameTitle` reserves a title revision), so it loses nothing it could have
 * kept.
 */
interface PinHolder {
  selector: string;
  order: number;
}
const holders = new Set<PinHolder>();
let nextOrder = 1;
/** Serializes the FILE writes; a write is one atomic replace, never held. */
let writeQueue: Promise<unknown> = Promise.resolve();

/** Write the selector the current holders agree on (newest wins), or clear. */
function syncOverlay(): Promise<void> {
  const newest = [...holders].sort((a, b) => b.order - a.order)[0];
  const selector = newest?.selector;
  const run = writeQueue.then(() => writeOverlay(selector));
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Run `fn` with the title role pointed at `selector`, and release the pin when
 * `fn` settles.
 *
 * `selector` of `undefined` (a session whose model cannot be read) runs `fn`
 * untouched: naming a session with a model the conversation never used is worse
 * than the role the user configured. The release is in a `finally`, so a refused
 * or failed rename cannot leave the role pinned for the next child that loads
 * the overlay.
 *
 * `fn` should resolve when the generation is DONE, not when the request is
 * dispatched: omp resolves the title role again for the card request that
 * follows a successful title, so releasing on the ack names the session with
 * the configured role — the failure this pin exists to prevent.
 */
export function withTitleModelOverride<T>(selector: string | undefined, fn: () => Promise<T>): Promise<T> {
  if (!selector) return fn();
  const holder: PinHolder = { selector, order: nextOrder++ };
  holders.add(holder);
  return syncOverlay()
    .then(() => Bun.sleep(OVERLAY_SETTLE_MS))
    .then(fn)
    .finally(async () => {
      holders.delete(holder);
      await syncOverlay();
    });
}
