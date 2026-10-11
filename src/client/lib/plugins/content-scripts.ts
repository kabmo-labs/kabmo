/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Content scripts: a plugin's code that enhances the app shell without
 * rendering a slot.
 *
 * This is the only contribution that lets a plugin touch DOM the host did not
 * hand it, so the LIFECYCLE is the feature rather than an implementation
 * detail:
 *
 * - **Disposal is exact-once and reverse-order.** A script that mounts twice
 *   doubles its listeners; one that never unmounts leaks them for the life of
 *   the page. Both are silent, which is why every rule here is asserted.
 * - **The old generation is disposed BEFORE the new one mounts**, so two
 *   generations never overlap — a reload is a replacement, not an addition.
 * - **`signal` aborts on teardown**, so an async mount cannot finish after its
 *   own disposal and attach to a DOM nobody will clean.
 * - **A throwing mount is reported and rolled back.** The host mounts into a
 *   DETACHED container first and moves it in only on success, so a mount that
 *   throws halfway leaves nothing behind.
 *
 * The generation counter is per plugin and monotonic, so a script can key its
 * own DOM by it and a stale generation can be recognised rather than guessed at.
 */

import type { ContentScriptRegistration } from '@ompchamber/plugin-sdk';

/** One mounted generation, held so it can be taken down in order. */
interface MountedScript {
  pluginId: string;
  registration: ContentScriptRegistration;
  generation: number;
  abort: AbortController;
  /** The disposer the script returned, or null when its mount never resolved. */
  dispose: (() => void) | null;
}

/**
 * The live generations, process-wide.
 *
 * Anchored on `globalThis` for the reason every other registry here is: under
 * `bun --hot` this module re-evaluates while mounted scripts are still attached,
 * and a module-level list would come back empty — their disposers would be
 * unreachable and the next mount would run a second copy beside the first.
 */
declare global {
  // eslint-disable-next-line no-var
  var __ompChamberContentScripts: MountedScript[] | undefined;
  // eslint-disable-next-line no-var
  var __ompChamberContentGeneration: number | undefined;
}

function mounted(): MountedScript[] {
  return (globalThis.__ompChamberContentScripts ??= []);
}

/** The next generation number. Monotonic across every plugin. */
function nextGeneration(): number {
  return (globalThis.__ompChamberContentGeneration = (globalThis.__ompChamberContentGeneration ?? 0) + 1);
}

/**
 * The document a mount targets.
 *
 * A content script adds its own nodes, so this is not a parent the host moves
 * them into — it is the READINESS gate: a mount with no document to run in must
 * be reported, not run against `undefined`. Resolved per call, because the
 * layout may not have mounted when a plugin's bundle finished loading.
 */
export interface ContentScriptHost {
  /** The document to mount into, or null when there is not one yet. */
  target: () => Element | null;
}

/** What went wrong, in a shape the caller can report. */
export interface ContentScriptFailure {
  pluginId: string;
  reason: string;
}

/**
 * Mount every registered content script.
 *
 * Sequential and awaited, because a script's mount may be async and the caller
 * needs the generations to be up (or reported) before it continues — a reload
 * that returned early would let a button fire into a half-mounted page.
 *
 * Returns the failures rather than throwing: one broken script must not stop
 * the others, and the caller reports them.
 */
export async function mountContentScripts(
  pluginId: string,
  registrations: readonly ContentScriptRegistration[],
  host: ContentScriptHost,
): Promise<ContentScriptFailure[]> {
  // The replacement rule: this plugin's previous generations go FIRST, so two
  // generations of one plugin never coexist. Reverse order, so a script that
  // mounted last (and may depend on an earlier one) comes down first.
  await unmountContentScripts(pluginId);

  const target = host.target();
  if (!target) return [{ pluginId, reason: 'no host element to mount into' }];

  const failures: ContentScriptFailure[] = [];
  for (const registration of registrations) {
    const generation = nextGeneration();
    const abort = new AbortController();
    const record: MountedScript = { pluginId, registration, generation, abort, dispose: null };
    // Pushed BEFORE the mount resolves, so a teardown that arrives while an
    // async mount is in flight still finds the generation and aborts it.
    mounted().push(record);

    // A content script owns the DOM it adds — the contract hands it no
    // container (matching bb's), so the host has nothing of its own to stage or
    // roll back. What the host owns is the RECORD: a mount that throws must not
    // leave a generation the reaper can never reach.
    try {
      const dispose = await registration.mount({ pluginId, generation, signal: abort.signal });
      if (abort.signal.aborted) {
        // Teardown already ran while this mount was in flight. The script's own
        // disposer is the only thing that can undo it.
        callDisposer(dispose);
        continue;
      }
      if (typeof dispose !== 'function') {
        throw new Error('mount() answered no disposer — the host cannot clean this script up');
      }
      record.dispose = dispose;
    } catch (error) {
      removeRecord(record);
      failures.push({ pluginId, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return failures;
}

/** Take one plugin's generations down, newest first, exactly once. */
export async function unmountContentScripts(pluginId: string): Promise<void> {
  const all = mounted();
  const mine = all.filter((entry) => entry.pluginId === pluginId);
  for (const entry of [...mine].reverse()) {
    // Removed BEFORE the disposer runs: a disposer that throws must not be
    // retried on the next teardown, and a second teardown must find nothing.
    removeRecord(entry);
    // Abort first, so an async mount still in flight knows not to attach.
    entry.abort.abort();
    callDisposer(entry.dispose);
  }
}

/** Take every plugin's generations down. Used by window teardown and tests. */
export async function unmountAllContentScripts(): Promise<void> {
  for (const pluginId of new Set(mounted().map((entry) => entry.pluginId))) {
    await unmountContentScripts(pluginId);
  }
}

/** Whether a generation is still live — the check a script may make in a callback. */
export function isGenerationLive(generation: number): boolean {
  return mounted().some((entry) => entry.generation === generation);
}

function removeRecord(record: MountedScript): void {
  const all = mounted();
  const index = all.indexOf(record);
  if (index >= 0) all.splice(index, 1);
}

/**
 * Run a disposer, swallowing a throw.
 *
 * A disposer that throws must not stop the OTHER generations from coming down:
 * they own listeners too, and leaking them is worse than a log line.
 */
function callDisposer(dispose: (() => void) | null): void {
  if (!dispose) return;
  try {
    dispose();
  } catch {
    // Deliberately swallowed: see above.
  }
}

/** Test seam: forget every generation without running disposers. */
export function resetContentScripts(): void {
  mounted().length = 0;
}
