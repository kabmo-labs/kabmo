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
 * ## Painted on the INPUT, not on the scroll it causes
 *
 * The bar is painted by the `wheel`/`touch*` handler itself, on the nearest
 * ancestor under the pointer that can overflow. Waiting for the `scroll` event
 * means painting a frame late at best and not at all at worst — a browser
 * dispatches `scroll` at its own frame boundary, and the gate below declines
 * the scrolls it cannot attribute to a user. The `scroll` path is still wired,
 * and it is the one that covers a scrollbar-thumb drag and the document's own
 * scroll; the input path is what makes "the bar appears the moment you scroll"
 * true without depending on either.
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
 * So the reveal is gated on INPUT: a `wheel`, `touch*`, `keydown` or a pointer
 * press ARMS exactly one reveal, and the next scroll consumes it. A held
 * pointer is tracked as its own state, because a scrollbar drag outlives any
 * expiry. That is what keeps a programmatic scroll from lighting a bar on its
 * own, and what stops a stream from pinning one: the arm is spent by the first
 * scroll, and every later frame has nothing left to spend.
 *
 * The arm EXPIRES (`SCROLLBAR_INPUT_ARM_MS`) so a gesture cannot vouch for a
 * scroll made much later, and it is compared on the events' own timestamps
 * rather than on the clock read inside the handler.
 *
 * Two earlier shapes failed, and both are why this is an arm:
 *
 * - A 250ms rolling window read `Date.now()` inside the handler. Scroll events
 *   are delivered at the next frame, so a busy main thread aged the user's own
 *   wheel into "not theirs" and the bar stayed hidden while they scrolled.
 * - The same window compared on `Event.timeStamp` fixed Chrome and still failed
 *   in WebKit, which stamps a scroll when it is DISPATCHED: measured in WebKit
 *   27.2, a wheel followed by a 700ms blocked frame produced a scroll stamped
 *   703ms after that wheel, and the bar stayed dark while the container moved
 *   240px. No timestamp can separate a late delivery from a late user there.
 *
 * An arm asks a question no clock has to answer: has any input happened since
 * the last reveal? That holds under either stamping rule, and it is still
 * one-shot, so it cannot pin a bar.
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

import {
  belongsTo,
  eventMoment,
  isScrollKey,
  nearestScroller,
  scrolledElement,
} from '@/client/lib/scrollbar-events';

/** The attribute `tailwind.css` selects on. One name, two files. */
export const SCROLLBAR_ACTIVE_ATTRIBUTE = 'data-scrollbar-active';

/** How long a container keeps its thumb after the user stops scrolling it. */
export const SCROLLBAR_IDLE_MS = 5_000;

/**
 * How long one input may vouch for the NEXT scroll.
 *
 * The arm exists to bridge a DELAYED DELIVERY, not to model a gesture: a wheel
 * arms, and the scroll it causes may be dispatched a frame later — or, on a
 * blocked main thread, much later. WebKit measured 700ms for a single stalled
 * frame, so the bound has to clear that with room to spare while still expiring
 * long before a gesture could be confused with a programmatic scroll made much
 * later. Two seconds is that middle ground; it is not a gesture timeout.
 */
export const SCROLLBAR_INPUT_ARM_MS = 2_000;

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


/**
 * Wire the reveal rule for one document. Idempotent per document.
 *
 * Both windows are parameters only so a test can drive them without waiting
 * seconds; production passes nothing and takes the two constants.
 */
export function installScrollbarActivity(
  idleMs = SCROLLBAR_IDLE_MS,
  armMs = SCROLLBAR_INPUT_ARM_MS,
): void {
  if (typeof document === 'undefined') return;
  const host = globalThis as ScrollbarActivityHost;
  const wired = (host.__kabmoScrollbarActivity ??= new WeakSet<Document>());
  if (wired.has(document)) return;
  wired.add(document);

  // Per element, so an element unmounted mid-fade is collected with its timer
  // instead of being held alive by a map entry that still owes it a callback.
  const timers = new WeakMap<Element, FadeTimer>();

  /**
   * When the user produced the input that may vouch for the NEXT scroll, or
   * `null` when nothing is armed.
   *
   * `null` is the starting state and the state after every consumption, which
   * is what makes this a one-shot: a wheel buys exactly one reveal, so a
   * programmatic scroll that follows it has nothing to spend. An earlier
   * version kept a rolling timestamp instead, and a stream's own auto-follow
   * rode that timestamp for as long as it was refreshed.
   */
  let armedAt: number | null = null;
  /** Where that input happened, so its arm belongs to that container only. */
  let armedIn: EventTarget | null = null;
  /**
   * True between a pointer press and its release.
   *
   * A scrollbar drag is one press followed by a stream of scrolls that can last
   * far longer than {@link armMs}, and each of those scrolls is the user's
   * without a fresh input event to spend — so the press is tracked as a state
   * rather than as an arm.
   */
  let heldPointer = false;

  const noteInput = (event: Event) => {
    armedAt = eventMoment(event);
    armedIn = event.target;
  };

  /** Paint `element`'s bar and start its idle window over. */
  const reveal = (element: Element) => {
    element.setAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE, '');
    clearTimeout(timers.get(element));
    timers.set(
      element,
      setTimeout(() => {
        timers.delete(element);
        element.removeAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE);
      }, idleMs),
    );
  };

  /**
   * Reveal the surface the user's input is aimed at, AT INPUT TIME.
   *
   * Waiting for the `scroll` event means the bar is painted on the frame after
   * the input — and a scroll the gate declines (a programmatic follow, an
   * engine that dispatches the scroll after the frame budget) paints nothing at
   * all. Painting here makes "the bar appears the moment you scroll" true by
   * construction, and it costs no layout: the walk stops at the first ancestor
   * that can actually overflow.
   *
   * Only input paints, so a stream's auto-follow still cannot light a bar. Each
   * wheel event of a gesture restarts the idle window, which is what makes the
   * bar stay up for as long as the user keeps scrolling instead of for 5s after
   * the first tick of the gesture.
   */
  const revealUnderPointer = (event: Event) => {
    const element = nearestScroller(event.target);
    if (element) reveal(element);
  };

  const noteScrollingInput = (event: Event) => {
    noteInput(event);
    revealUnderPointer(event);
  };

  const pressPointer = (event: Event) => {
    heldPointer = true;
    noteInput(event);
  };
  const releasePointer = (event: Event) => {
    heldPointer = false;
    // The release itself is input: a scroll it triggers is still the user's.
    noteInput(event);
  };

  // Every one of these is passive: none of them ever calls `preventDefault`,
  // and a non-passive wheel listener is a documented cause of scroll jank.
  const INPUT_OPTIONS = { capture: true, passive: true } as const;
  for (const type of ['wheel', 'touchstart', 'touchmove'] as const) {
    document.addEventListener(type, noteScrollingInput, INPUT_OPTIONS);
  }
  // Only the keys that scroll arm the gate. A keydown that types a character
  // says nothing about scrolling, and arming on it let a stream's next
  // auto-follow paint a bar while the reader was typing in the composer.
  document.addEventListener(
    'keydown',
    (event) => {
      if (isScrollKey(event as KeyboardEvent)) noteInput(event);
    },
    INPUT_OPTIONS,
  );
  // `mousedown`/`mouseup` ride along with the pointer pair so an engine that
  // synthesizes no pointer events for a native scrollbar still counts the drag.
  document.addEventListener('pointerdown', pressPointer, INPUT_OPTIONS);
  document.addEventListener('mousedown', pressPointer, INPUT_OPTIONS);
  document.addEventListener('pointerup', releasePointer, INPUT_OPTIONS);
  document.addEventListener('mouseup', releasePointer, INPUT_OPTIONS);
  document.addEventListener('pointercancel', releasePointer, INPUT_OPTIONS);
  // A press whose release never arrives (the drag ended outside the window, the
  // OS took the pointer) must not leave the flag stuck on: that would restore
  // the very bug this gate exists to fix, one press at a time. The ARM goes
  // with it — once the window has been left, nothing that happened before is
  // evidence about a scroll that happens after.
  window.addEventListener('blur', () => {
    heldPointer = false;
    armedAt = null;
    armedIn = null;
  });

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
      //
      // The arm is compared on EVENT moments (see `eventMoment`), so a frame
      // the main thread spent rendering cannot age the input that armed it.
      const armed = armedAt !== null
        && eventMoment(event) - armedAt <= armMs
        && belongsTo(element, armedIn);
      if (!heldPointer && !armed) return;
      // Spent. A later scroll needs its own input, which is what keeps a run's
      // auto-follow from riding one wheel for the whole turn.
      if (!heldPointer) {
        armedAt = null;
        armedIn = null;
      }
      reveal(element);
    },
    // Passive for the same reason the input listeners are.
    { capture: true, passive: true },
  );
}
