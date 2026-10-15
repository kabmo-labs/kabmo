/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The scrollbar reveal rule, for EVERY scroll container in the document.
 *
 * A container's thumb is transparent at rest, painted while that container is
 * being scrolled, and hidden again `SCROLLBAR_IDLE_MS` after its last scroll.
 * One behaviour for the whole app, enforced in one place — because the
 * alternative, the per-component `useScrollbarFadeRef` hook this replaces,
 * could only ever cover the containers that opted in. Eleven of the ~70
 * scroll surfaces in the codebase did, so a modal, a dropdown, the git panel
 * and every plugin panel drew a permanently visible bar while the chat
 * timeline and the sidebar faded. Nothing about that is a per-component
 * decision, so nothing about it should be wired per component.
 *
 * ## Why one document listener is enough
 *
 * `scroll` does not bubble, so a bubble-phase listener on `document` would only
 * ever see the document's own scroll. A CAPTURE-phase listener sees the event
 * on its way down to the scroller, and `event.target` is the element that
 * actually scrolled — verified in Chromium 150 against a descendant scroller,
 * where the document's capture listener fired with `target` === that element.
 * One listener therefore serves every scroller that exists now and every one
 * mounted later (a modal opened an hour into the session), with no hook, no
 * ref, and no per-component wiring.
 *
 * ## The other half of the contract
 *
 * `tailwind.css` declares `::-webkit-scrollbar-thumb` transparent and paints it
 * for `[data-scrollbar-active]`. `SCROLLBAR_ACTIVE_ATTRIBUTE` is exported so
 * the stylesheet's own test can assert the two halves still agree — a rename on
 * one side alone would silently disable the fade everywhere with no error.
 *
 * The root scroller is the one case where the event's target is not the element
 * whose scrollbar is painted: the viewport's scroll reports `document` (or
 * `window`), while the bar belongs to the root element, so the attribute goes
 * on `documentElement`.
 */

/** The attribute `tailwind.css` selects on. One name, two files. */
export const SCROLLBAR_ACTIVE_ATTRIBUTE = 'data-scrollbar-active';

/** How long a container keeps its thumb after the user stops scrolling it. */
export const SCROLLBAR_IDLE_MS = 10_000;

/**
 * Documents already wired, on `globalThis` rather than in a module binding.
 *
 * `bun --hot` re-evaluates a changed module while the page keeps its document,
 * so a module-level `WeakSet` would be emptied by a reload and the listener
 * added a second time — every scroll would then arm two timers for the same
 * element. Keyed by document rather than a boolean so a test that swaps in a
 * fresh window still gets a real install.
 */
interface ScrollbarActivityHost {
  __ompChamberScrollbarActivity?: WeakSet<Document>;
}

/** A pending fade. Named here rather than re-derived per site because the DOM
 *  and Bun/Node typings disagree on what `setTimeout` returns. */
type FadeTimer = ReturnType<typeof setTimeout>;

/** The element whose scrollbar the event describes. */
function scrolledElement(target: EventTarget | null): Element | null {
  if (target === document || target === window || target === null) {
    // The viewport's own scroll: the bar that is painted belongs to the root
    // element, not to the document the event names.
    return document.documentElement;
  }
  return target instanceof Element ? target : null;
}

/**
 * Wire the reveal rule for one document. Idempotent per document.
 *
 * `idleMs` is a parameter only so a test can drive the fade without waiting ten
 * seconds; production passes nothing and takes `SCROLLBAR_IDLE_MS`.
 */
export function installScrollbarActivity(idleMs = SCROLLBAR_IDLE_MS): void {
  if (typeof document === 'undefined') return;
  const host = globalThis as ScrollbarActivityHost;
  const wired = (host.__ompChamberScrollbarActivity ??= new WeakSet<Document>());
  if (wired.has(document)) return;
  wired.add(document);

  // Per element, so an element unmounted mid-fade is collected with its timer
  // instead of being held alive by a map entry that still owes it a callback.
  const timers = new WeakMap<Element, FadeTimer>();

  document.addEventListener(
    'scroll',
    (event) => {
      const element = scrolledElement(event.target);
      if (!element) return;
      element.setAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE, '');
      clearTimeout(timers.get(element));
      timers.set(
        element,
        setTimeout(() => {
          timers.delete(element);
          element.removeAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE);
        }, idleMs),
      );
    },
    // Passive: the handler never calls `preventDefault`, and a non-passive
    // scroll listener is a documented cause of scroll jank.
    { capture: true, passive: true },
  );
}
