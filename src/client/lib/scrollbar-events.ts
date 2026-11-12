/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The DOM questions the scrollbar reveal rule asks, split from the rule itself
 * so each file stays readable: WHICH element a scroll is about, WHICH element
 * an input is aimed at, WHEN an event happened, and whether a key scrolls.
 *
 * Nothing here keeps state. `scrollbar-activity.ts` owns the listener, the arm
 * and the fade timer; these are the pure answers it consults, kept separate so
 * they can be reasoned about (and changed) without reading the gate.
 */

/** The element whose scrollbar the event describes. */
export function scrolledElement(target: EventTarget | null): Element | null {
  if (target === document || target === window || target === null) {
    // The viewport's own scroll: the bar that is painted belongs to the root
    // element, not to the document the event names.
    return document.documentElement;
  }
  return target instanceof Element ? target : null;
}

/**
 * WHEN an event happened, on the one clock the arm is compared on.
 *
 * `Date.now()` read inside a handler is when the handler RAN, and the two are
 * not the same moment: scroll events are coalesced and delivered at the next
 * frame, so a main thread busy with a long task (a streamed markdown render, a
 * 36 000px transcript re-layout) can delay delivery by hundreds of milliseconds.
 * `Event.timeStamp` is stamped when the event is CREATED, which is what makes
 * the arm's expiry mean "this input is old" rather than "this handler is late".
 *
 * Engines disagree about the scroll stamp — Chrome stamps at creation, WebKit
 * at dispatch — so this clock cannot decide whether a scroll was the user's.
 * That is why the gate is an ARM (did any input happen since the last reveal?)
 * and not a gap: the arm only has to bound how stale an input may be, and both
 * engines answer that.
 *
 * The fallback covers synthetic events and engines that report a non-positive
 * stamp (`0` is what a hand-built `new Event('scroll')` carries). It answers
 * `performance.now()` and not `Date.now()`: `Event.timeStamp` is a
 * `DOMHighResTimeStamp`, so mixing in wall time would make the subtraction a
 * difference of two different clocks — measured as a negative gap, which would
 * make every programmatic scroll look armed.
 */
export function eventMoment(event: Event): number {
  const stamp = event.timeStamp;
  return Number.isFinite(stamp) && stamp > 0 ? stamp : performance.now();
}

/** The `overflow` values that make an element a surface the USER can scroll. */
const SCROLLABLE_OVERFLOW: Readonly<Record<string, true>> = { auto: true, scroll: true, overlay: true };

/**
 * The nearest ancestor of `target` that the user's input would scroll.
 *
 * This answers, at INPUT time, the question the `scroll` event answers a frame
 * later — which is what lets the bar be painted the moment the wheel turns
 * instead of after the scroll lands. `target` itself is checked first, since a
 * wheel over a scroller's own padding targets the scroller.
 *
 * No fallback to the document: an input over an element that names no scroller
 * leaves the page's own reveal to the `scroll` path (where the root element is
 * known to be the painted surface). Returning the root here would light the
 * page's bar for a wheel that moved a panel.
 */
export function nearestScroller(target: EventTarget | null): Element | null {
  let node: Element | null = target instanceof Element ? target : null;
  for (; node && node !== document.body; node = node.parentElement) {
    // The size test runs first: a node that cannot overflow is not a scroll
    // surface whatever its `overflow` says, and reading it costs no style pass.
    if (node.scrollHeight <= node.clientHeight + 1 && node.scrollWidth <= node.clientWidth + 1) continue;
    // Through the node's own window rather than the global: the same tree is
    // mounted in a document this module did not capture, and `getComputedStyle`
    // is not a global in every host that runs it (the unit tests included).
    const view = node.ownerDocument?.defaultView;
    if (!view) continue;
    const style = view.getComputedStyle(node);
    if (SCROLLABLE_OVERFLOW[style.overflowY] || SCROLLABLE_OVERFLOW[style.overflowX]) return node;
  }
  return null;
}

/** The keys that scroll the focused surface (never a typing key). */
const SCROLL_KEYS: Readonly<Record<string, true>> = {
  ArrowUp: true,
  ArrowDown: true,
  ArrowLeft: true,
  ArrowRight: true,
  PageUp: true,
  PageDown: true,
  Home: true,
  End: true,
  ' ': true,
  Spacebar: true,
};

/**
 * Whether an input happened INSIDE the container that scrolled.
 *
 * An arm is spent by the first scroll that follows it, which is what stops a
 * stream from pinning a bar — but "first scroll anywhere" was too loose: a
 * wheel that cannot move its container (already at the top) produces no scroll
 * event, so its arm stayed unspent for the rest of its life and the next
 * PROGRAMMATIC scroll in any other panel could spend it. Measured: wheel up at
 * `scrollTop = 0`, then `scrollTop = 500` 250ms later, and the bar lit for a
 * scroll nobody made.
 *
 * Binding the arm to the subtree the input happened in closes that without
 * adding a layout read: `contains` is a tree walk, not a `getComputedStyle`,
 * and the wheel's target is already the element under the pointer.
 *
 * An input that names the document or the window itself (a keydown with nothing
 * focused) is deliberately NOT bound — the scroller it drives is the focused
 * one, which no target reveals, so it keeps the unbound behaviour. `body` and
 * the root element are the same case in practice: a keydown with nothing
 * focused targets `body`, and MEASURED in Chromium and WebKit 27.2, PageDown
 * there scrolls the panel the reader last clicked — a container `body` neither
 * contains nor is contained by. Treating `body` as bound is what made keyboard
 * scrolling reveal no bar at all.
 */
export function belongsTo(element: Element, inputTarget: EventTarget | null): boolean {
  if (
    inputTarget === null
    || inputTarget === document
    || inputTarget === window
    || inputTarget === document.body
    || inputTarget === document.documentElement
  ) {
    return true;
  }
  if (inputTarget === element) return true;
  return inputTarget instanceof Node ? element.contains(inputTarget) : false;
}

/** Whether a key press is a scroll of the focused surface (never a typing key). */
export function isScrollKey(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  return SCROLL_KEYS[event.key] === true;
}
