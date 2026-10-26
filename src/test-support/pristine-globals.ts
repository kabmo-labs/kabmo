/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The runner's own globals that test files replace, captured when this module is
 * FIRST imported.
 *
 * That import happens while a test file is being loaded — before its own hooks,
 * and therefore before any test has run — so the value here is the runner's own.
 * A file's own `const native = globalThis.X` is only as good as WHEN that file
 * was imported: a file imported after another suite installed its fake captures
 * the FAKE, and then faithfully restores it for everyone after. That is why
 * every file that installs a fake must import this module (the capture is taken
 * before the first fake exists), and why a file that only READS the global puts
 * this value back before each case. `fetch` has `Bun.fetch` for the same job;
 * `WebSocket` has no such handle.
 */
export const pristineWebSocket = globalThis.WebSocket;

/**
 * The globals a hook test replaces, in one place.
 *
 * `WebSocket` and `EventSource` belong here even though a happy-dom window
 * provides them: a suite that installs a socket STUB must have it restored, or
 * the stub leaks into every later file and a suite that needs the real socket
 * dials nothing — with a failure that names none of the files responsible.
 */
export const DOM_TEST_GLOBALS = [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement',
  'Event', 'CustomEvent', 'WebSocket', 'EventSource',
  // The three DOM data classes, because a suite that swaps `window` usually needs them and
  // a LOCAL save-and-restore loop is how they leaked: `editor/save-as.test.ts` installed
  // happy-dom's `File`/`Blob` and never put them back, so a later file's `carriesBytes` read
  // a happy-dom `File` whose `slice().arrayBuffer()` answered empty and reported that a real
  // file held no bytes — a failure in a suite that file does not name. Listed here, they are
  // captured on the first install and restored with the rest.
  'FormData', 'File', 'Blob',
] as const;

/**
 * The runner's own DOM globals, captured when this module is FIRST imported —
 * before any suite has replaced them.
 *
 * A file's own `const native = globalThis.window` is only as good as WHEN that
 * file was imported: in a directory run Bun imports every file before any test
 * runs, so a file imported after another suite installed (or DELETED) a global
 * captures the replacement. Restoring that captured value then leaves the
 * runner's real global missing for every later file, which surfaces as
 * "Attempted to assign to readonly property" or a socket dialing nowhere — in a
 * suite that names none of the files responsible.
 *
 * Captured here, at module load of a support file that no suite replaces, so it
 * is always the runner's own.
 */
export const pristineDomGlobals: Partial<Record<(typeof DOM_TEST_GLOBALS)[number], unknown>> = {};
let captured = false;

/**
 * The `on*` drag properties happy-dom does not define, and Preact needs.
 *
 * Preact picks a listener's DOM event name by asking whether `name in dom`
 * (`diff/props.js`): a property that exists means it can lower-case the prop
 * (`onDragStart` → `dragstart`), and one that does not falls back to stripping
 * `on` only — registering a listener for the event `DragStart`, which never
 * fires. Real browsers define all of these on `HTMLElement`; happy-dom defines
 * `onclick` and `oncontextmenu` but none of the drag family, so a component's
 * drag handlers were silently inert under test while working in a browser.
 *
 * Defined here rather than in one spec because the trap is Preact's, not the
 * Files panel's: any component with drag handlers hits it.
 */
const DRAG_EVENT_PROPERTIES = [
  'ondrag', 'ondragstart', 'ondragend', 'ondragenter', 'ondragleave', 'ondragover', 'ondrop',
] as const;

/** Give `win`'s element prototype the drag properties a browser has. */
export function installDragEventProperties(win: unknown): void {
  // happy-dom's `Window` is not structurally nameable here without importing it
  // (this module is imported by suites that never touch a DOM), so the lookup
  // is guarded rather than asserted — a caller handing a bare stub simply gets
  // no shim, which is the same state it was in before.
  if (typeof win !== 'object' || win === null || !('HTMLElement' in win)) return;
  const ctor = win.HTMLElement;
  if (typeof ctor !== 'function') return;
  for (const name of DRAG_EVENT_PROPERTIES) {
    if (name in ctor.prototype) continue;
    Object.defineProperty(ctor.prototype, name, { value: null, writable: true, configurable: true });
  }
}

/**
 * Replace the DOM globals with a happy-dom window's, for a suite that renders
 * components. Pairs with `restoreDomGlobals`.
 *
 * The runner's own values are captured HERE, on the first install, rather than
 * at module load. Bun runs a directory's files one at a time (load, run, next),
 * so a module-load capture is only as good as which file happened to import
 * this module first — a suite that installed a stub and ran earlier would have
 * its stub captured as "pristine" and restored for everyone after.
 */
export function installDomGlobals(win: unknown): void {
  const target = globalThis as unknown as Record<string, unknown>;
  installDragEventProperties(win);
  if (!captured) {
    captured = true;
    for (const key of DOM_TEST_GLOBALS) pristineDomGlobals[key] = target[key];
  }
  // `window` is always the given object — a caller may hand a bare stub with
  // only the members its code reads, and requiring a full happy-dom window
  // would force every such test to build one.
  target.window = win;
  const source = win as Record<string, unknown>;
  for (const key of DOM_TEST_GLOBALS) {
    if (key === 'window') continue;
    const value = source[key];
    if (value !== undefined) target[key] = value;
  }
}

/** Put the runner's own DOM globals back. Never deletes: a deleted global is
 *  what breaks the next suite, and an absent one is restored as absent. */
export function restoreDomGlobals(): void {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_TEST_GLOBALS) {
    const value = pristineDomGlobals[key];
    if (value === undefined) delete target[key];
    else target[key] = value;
  }
}
