/**
 * @license
 * SPDX-License-Identifier: MIT
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
 * - **Every script is handed a scoped ROOT element**, and that is the CSS half
 *   of the contract: the plugin's stylesheet is served wrapped in
 *   `@scope ([data-plugin-surface="<id>"])`, so DOM appended outside that
 *   element is unreachable by the plugin's own CSS. The host removes the whole
 *   subtree on teardown, so a node left inside it needs no removal of its own.
 *
 * The generation counter is per plugin and monotonic, so a script can key its
 * own DOM by it and a stale generation can be recognised rather than guessed at.
 */

import type { ContentScriptRegistration } from '@kabmo-labs/kabmo-sdk';
import { PLUGIN_SURFACE_ATTR } from '@kabmo-labs/kabmo-sdk';

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
  var __kabmoContentScripts: MountedScript[] | undefined;
  // eslint-disable-next-line no-var
  var __kabmoContentGeneration: number | undefined;
  // eslint-disable-next-line no-var
  var __kabmoContentScriptRoots: Map<string, HTMLElement> | undefined;
}

function mounted(): MountedScript[] {
  return (globalThis.__kabmoContentScripts ??= []);
}

/**
 * One root element per plugin, the DOM its scripts belong in.
 *
 * The element carries the plugin's scope attribute, which is what confines the
 * plugin's stylesheet (served wrapped in `@scope ([data-plugin-surface="…"])`)
 * to its own markup. A script that appends to `document.body` instead puts its
 * DOM outside every surface, where the plugin's own CSS cannot reach it — the
 * failure is silent, which is why the context hands the root over rather than
 * documenting one.
 *
 * The map is keyed by plugin id and lives beside the generations on `globalThis`
 * for the same hot-reload reason: a re-evaluated module must still find the
 * roots it has to remove.
 */
function roots(): Map<string, HTMLElement> {
  return (globalThis.__kabmoContentScriptRoots ??= new Map());
}

/** The next generation number. Monotonic across every plugin. */
function nextGeneration(): number {
  return (globalThis.__kabmoContentGeneration = (globalThis.__kabmoContentGeneration ?? 0) + 1);
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
  // mounted last (and may depend on an earlier one) comes down first. The root
  // element goes with them, so the new generation starts from an empty one.
  await unmountContentScripts(pluginId);

  const target = host.target();
  if (!target) return [{ pluginId, reason: 'no host element to mount into' }];

  const root = createRoot(target, pluginId);
  const failures: ContentScriptFailure[] = [];
  for (const registration of registrations) {
    const generation = nextGeneration();
    const abort = new AbortController();
    const record: MountedScript = { pluginId, registration, generation, abort, dispose: null };
    // Pushed BEFORE the mount resolves, so a teardown that arrives while an
    // async mount is in flight still finds the generation and aborts it.
    mounted().push(record);

    // A content script owns the DOM it adds, but the CONTAINER is the host's:
    // the plugin's CSS is scoped to it, so a script that mounted into
    // `document.body` would put its own nodes out of its own stylesheet's
    // reach. What the host owns is the RECORD: a mount that throws must not
    // leave a generation the reaper can never reach.
    try {
      const dispose = await registration.mount({ pluginId, root, generation, signal: abort.signal });
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
  // A registration list that produced no generation at all leaves an empty root
  // behind; it is inert, but removing it keeps the document honest about which
  // plugins are live.
  if (mounted().every((entry) => entry.pluginId !== pluginId)) removeRoot(pluginId);
  return failures;
}

/**
 * The element a plugin's scripts mount into: a real node carrying the plugin's
 * scope attribute, appended to `target`.
 *
 * `display: contents` so it generates no box — a content script's own nodes lay
 * out exactly as they would have if appended directly — while still being a
 * node the `@scope` prelude can root at.
 */
function createRoot(target: Element, pluginId: string): HTMLElement {
  const root = target.ownerDocument.createElement('div');
  root.setAttribute(PLUGIN_SURFACE_ATTR, pluginId);
  root.style.display = 'contents';
  target.appendChild(root);
  roots().set(pluginId, root);
  return root;
}

/** Remove a plugin's root element, if one is held. */
function removeRoot(pluginId: string): void {
  roots().get(pluginId)?.remove();
  roots().delete(pluginId);
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
  // After the disposers, not before: a disposer that reaches into the root it
  // was handed must still find it. Removing the whole subtree is what takes a
  // script's nodes with it, so the contract does not ask each disposer to undo
  // its own DOM — only to release what the host cannot (listeners, timers).
  removeRoot(pluginId);
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
  roots().clear();
}
