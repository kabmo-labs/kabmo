/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The scrollbar reveal rule, for EVERY scroll container in the document.
 *
 * A container's thumb is transparent at rest, painted while the USER scrolls
 * that container, and hidden again `SCROLLBAR_IDLE_MS` after their last scroll.
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
 * ## A scroll is not proof of a user, and that is the whole second rule
 *
 * A programmatic scroll fires a REAL `scroll` event — `isTrusted` is `true`
 * for `el.scrollTop = n` and for a smooth `scrollTo`, verified in Chromium, so
 * the event itself cannot tell the two apart. Revealing on every scroll
 * therefore paints the bar for as long as anything else moves the container,
 * with nobody touching the page. Measured on the chat timeline against a live
 * stream: the run's stick-to-bottom `pinToBottom` re-armed the fade on every
 * frame, the attribute never lapsed for 24 s of a single turn, and the bar was
 * still painted with the pointer parked in a corner — the reported "the
 * scrollbar does not disappear when there is no user activity". The same shape
 * covers every `scrollIntoView` (a rail jump, a search reveal, an outline jump)
 * and the editor's scroll restore.
 *
 * So the reveal is gated on recent INPUT, not on the scroll event: a `wheel`,
 * `touch*`, `keydown` or a held pointer (a scrollbar drag lasts longer than any
 * input window, so the press state is tracked, not just the timestamp) marks
 * the user as scrolling, and a scroll that arrives inside that window is
 * theirs. A programmatic scroll neither reveals a bar nor extends a live
 * reveal — it leaves the fade running, so the bar still disappears on schedule
 * mid-run instead of being pinned there.
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
export const SCROLLBAR_IDLE_MS = 5_000;

/**
 * How recently the user must have produced input for a scroll to count as
 * theirs.
 *
 * This only has to bridge the gaps BETWEEN a user's own scroll events: wheel
 * events arrive per frame through the momentum phase, a held key repeats, and a
 * scrollbar drag is covered by {@link heldPointer} rather than by this window.
 * It is deliberately short — a long window would let a programmatic scroll that
 * happens to follow a click be mistaken for the user's own.
 */
export const SCROLLBAR_INPUT_WINDOW_MS = 250;

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
  __kabmoScrollbarActivity?: WeakSet<Document>;
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
 * Both windows are parameters only so a test can drive them without waiting
 * seconds; production passes nothing and takes the two constants.
 */
export function installScrollbarActivity(
  idleMs = SCROLLBAR_IDLE_MS,
  inputWindowMs = SCROLLBAR_INPUT_WINDOW_MS,
): void {
  if (typeof document === 'undefined') return;
  const host = globalThis as ScrollbarActivityHost;
  const wired = (host.__kabmoScrollbarActivity ??= new WeakSet<Document>());
  if (wired.has(document)) return;
  wired.add(document);

  // Per element, so an element unmounted mid-fade is collected with its timer
  // instead of being held alive by a map entry that still owes it a callback.
  const timers = new WeakMap<Element, FadeTimer>();

  /** When the user last produced input anywhere in the page. */
  let lastInputAt = 0;
  /**
   * True between a pointer press and its release.
   *
   * A scrollbar drag is one press followed by a stream of scrolls that can last
   * far longer than {@link inputWindowMs}; a timestamp alone would fade the bar
   * out from under a finger that is still dragging it.
   */
  let heldPointer = false;

  const noteInput = () => {
    lastInputAt = Date.now();
  };
  const pressPointer = () => {
    heldPointer = true;
    noteInput();
  };
  const releasePointer = () => {
    heldPointer = false;
    // The release itself is input: a scroll it triggers is still the user's.
    noteInput();
  };

  // Every one of these is passive: none of them ever calls `preventDefault`,
  // and a non-passive wheel listener is a documented cause of scroll jank.
  const INPUT_OPTIONS = { capture: true, passive: true } as const;
  for (const type of ['wheel', 'touchstart', 'touchmove', 'keydown'] as const) {
    document.addEventListener(type, noteInput, INPUT_OPTIONS);
  }
  // `mousedown`/`mouseup` ride along with the pointer pair so an engine that
  // synthesizes no pointer events for a native scrollbar still counts the drag.
  document.addEventListener('pointerdown', pressPointer, INPUT_OPTIONS);
  document.addEventListener('mousedown', pressPointer, INPUT_OPTIONS);
  document.addEventListener('pointerup', releasePointer, INPUT_OPTIONS);
  document.addEventListener('mouseup', releasePointer, INPUT_OPTIONS);
  document.addEventListener('pointercancel', releasePointer, INPUT_OPTIONS);
  // A press whose release never arrives (the drag ended outside the window, the
  // OS took the pointer) must not leave the flag stuck on: that would restore
  // the very bug this gate exists to fix, one press at a time.
  window.addEventListener('blur', () => { heldPointer = false; });

  document.addEventListener(
    'scroll',
    (event) => {
      const element = scrolledElement(event.target);
      if (!element) return;
      // A scroll the page performed on its own — streaming auto-follow, a
      // `scrollIntoView` jump, a restored offset — is not the user asking to
      // see the bar. It leaves an existing reveal and its timer alone, so the
      // bar still disappears on schedule instead of being held on screen for
      // the length of the run.
      const userDriven = heldPointer || Date.now() - lastInputAt <= inputWindowMs;
      if (!userDriven) return;
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
    // Passive for the same reason the input listeners are.
    { capture: true, passive: true },
  );
}
