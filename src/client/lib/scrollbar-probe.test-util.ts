/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The scaffolding both scrollbar suites mount against.
 *
 * Every case gets its OWN document and its own install, because the module is
 * idempotent per document and its input clock is per install: a shared document
 * would make every case inherit the previous one's wheel (and would make a
 * `useFakeTimers` clock that restarts at real time read as recent input).
 *
 * Mounted against happy-dom, the same way the other client tests are.
 */

import { Window } from 'happy-dom';
import { SCROLLBAR_INPUT_ARM_MS, installScrollbarActivity } from '@/client/lib/scrollbar-activity';

const DOM_GLOBALS = [
  'window',
  'document',
  'navigator',
  'Node',
  'Element',
  'HTMLElement',
  'Event',
  'CustomEvent',
] as const;

/** Short enough to drive in a test, long enough that the two windows do not overlap. */
export const IDLE_MS = 1_000;
/** The production arm; its real value is what the gate is about. */
export const ARM_MS = SCROLLBAR_INPUT_ARM_MS;

/** The runner's own globals, restored on teardown so later files still see native Event/CustomEvent/window. */
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

export function saveNativeGlobals(): void {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
  }
}

export function restoreNativeGlobals(): void {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
}

/** A fresh document with the reveal rule installed on it. */
export function freshPage(): void {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) target[key] = (win as unknown as Record<string, unknown>)[key];
  installScrollbarActivity(IDLE_MS, ARM_MS);
}

/** A scroll container in the live document. */
export function scroller(): HTMLElement {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return element;
}

/**
 * A container that MEASURES as scrollable.
 *
 * happy-dom lays nothing out, so every `scrollHeight`/`clientHeight` is 0 and
 * the "can this overflow" test the input path uses would skip every node. The
 * numbers are what Chromium reports for the same DOM shape.
 */
export function scrollSurface(): HTMLElement {
  const element = document.createElement('div');
  element.style.overflowY = 'auto';
  Object.defineProperties(element, {
    scrollHeight: { value: 900, configurable: true },
    clientHeight: { value: 300, configurable: true },
    scrollWidth: { value: 100, configurable: true },
    clientWidth: { value: 100, configurable: true },
  });
  document.body.appendChild(element);
  return element;
}

/** The event a browser dispatches at a scroller — it does not bubble. */
export function scrollAt(element: Element): void {
  element.dispatchEvent(new Event('scroll'));
}

/** The input a browser delivers before a scroll the USER caused.
 *
 * Dispatched ON the scroller, because that is what a wheel does: it is targeted
 * at the element under the pointer, and the arm is bound to that subtree so a
 * wheel that could not move its container cannot later vouch for a programmatic
 * scroll somewhere else. */
export function inputAt(element: Element = document.body): void {
  element.dispatchEvent(new Event('wheel'));
}

/** The keydown a browser delivers when the reader presses a scrolling key. */
export function keyAt(key: string): void {
  document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
}
