/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Reading what is under a mark, when the page allows it at all.
 *
 * The panel renders the user's page in an iframe, and a real dev server is a
 * DIFFERENT ORIGIN from Kabmo even on the same host: measured in Chromium, a
 * page on `127.0.0.1:7101` embedding `127.0.0.1:7102` reports
 * `contentDocument === null` (no throw — the check is free), while the same
 * origin reports a live document whose `elementFromPoint` answers `H2`.
 *
 * So this module has exactly two honest outcomes, and it never guesses:
 * an element, or a stated reason. A mark with no element is still a complete
 * mark — the user's label and note carry it — and the prompt says the page was
 * not readable instead of silently looking less capable.
 *
 * Coordinates arrive normalized to the panel (0..1) because that is what the
 * overlay stores. Inside the frame they map onto the frame's own viewport,
 * which is the one box `zoom` and a viewport preset never change the meaning of.
 */

import type { AnnotateElement, AnnotatePoint } from '@/shared/types';

/** Why a mark carries no element, or that it does. */
export type ElementAtResult =
  | { ok: true; element: AnnotateElement }
  | { ok: false; reason: 'no-frame' | 'cross-origin' | 'no-element' };

/** Longest visible text kept from a marked element, in UTF-16 units. */
const ELEMENT_TEXT_MAX_LEN = 60;
/** Levels of ancestry kept in a path; deeper paths stop telling the agent more. */
const ELEMENT_PATH_MAX_DEPTH = 4;

/** Whether the frame's document is readable at all — the whole game for this module. */
export function frameReadability(frame: HTMLIFrameElement | null): 'readable' | 'cross-origin' | 'no-frame' {
  if (!frame) return 'no-frame';
  try {
    return frame.contentDocument ? 'readable' : 'cross-origin';
  } catch {
    // A frame that throws is as unreadable as one that answers null.
    return 'cross-origin';
  }
}

/** Collapse whitespace and cut to the stored maximum, ending with an ellipsis. */
function shortText(value: string): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length > ELEMENT_TEXT_MAX_LEN
    ? `${collapsed.slice(0, ELEMENT_TEXT_MAX_LEN - 1)}…`
    : collapsed;
}

/** One step of a path: id wins, then the one identifying attribute, then the tag. */
function pathStep(element: Element): string {
  const tag = element.tagName.toLowerCase();
  if (element.id) return `${tag}#${element.id}`;
  for (const attribute of ['data-testid', 'data-test', 'aria-label']) {
    const value = element.getAttribute(attribute);
    if (value) return `${tag}[${attribute}="${shortText(value)}"]`;
  }
  const role = element.getAttribute('role');
  if (role) return `${tag}[role="${role}"]`;
  return tag;
}

/** `html > body > section … > select`, at most `ELEMENT_PATH_MAX_DEPTH` steps. */
export function elementPath(element: Element): string {
  const steps: string[] = [];
  let current: Element | null = element;
  while (current && steps.length < ELEMENT_PATH_MAX_DEPTH) {
    if (current.tagName.toLowerCase() === 'html') break;
    steps.unshift(pathStep(current));
    current = current.parentElement;
  }
  return steps.join(' > ');
}

/**
 * The state a form control is in — the part a screenshot could not tell the
 * agent and a user would have to type out by hand.
 */
function controlState(element: Element): string | undefined {
  const parts: string[] = [];
  if ((element as HTMLInputElement).disabled) parts.push('nonaktif');
  if (element instanceof HTMLSelectElement || element.tagName.toLowerCase() === 'select') {
    const select = element as HTMLSelectElement;
    const chosen = select.selectedOptions?.[0];
    const value = chosen?.textContent?.trim() || select.value;
    if (value) parts.push(`nilai "${shortText(value)}"`);
    const count = select.options?.length ?? 0;
    if (count > 0) parts.push(`${count} opsi`);
  } else if (element.tagName.toLowerCase() === 'input') {
    const input = element as HTMLInputElement;
    if (input.type) parts.push(`tipe ${input.type}`);
    // A password's value is never read; a placeholder is what the user sees.
    if (input.type !== 'password' && input.placeholder) parts.push(`placeholder "${shortText(input.placeholder)}"`);
  }
  return parts.length > 0 ? parts.join(', ') : undefined;
}

/** The element summary, without the coordinate work. */
export function describeElement(element: Element): AnnotateElement {
  const info: AnnotateElement = { path: elementPath(element), tag: element.tagName.toLowerCase() };
  const role = element.getAttribute('role');
  if (role) info.role = role;
  const text = shortText((element as HTMLElement).innerText ?? element.textContent ?? '');
  if (text) info.text = text;
  const state = controlState(element);
  if (state) info.state = state;
  return info;
}

/**
 * The element under a normalized point of the panel.
 *
 * `no-element` is a real answer: a mark over empty space has nothing beneath it,
 * and that is not the same fact as an unreadable page.
 */
export function elementAtPoint(frame: HTMLIFrameElement | null, point: AnnotatePoint): ElementAtResult {
  const readability = frameReadability(frame);
  if (readability !== 'readable') return { ok: false, reason: readability };
  const win = frame!.contentWindow;
  const doc = frame!.contentDocument;
  if (!win || !doc) return { ok: false, reason: 'cross-origin' };
  try {
    // The frame's own viewport is the box the normalized point is a fraction of;
    // the panel's CSS zoom and its viewport preset never enter this mapping.
    const x = Math.min(Math.max(point.x, 0), 1) * win.innerWidth;
    const y = Math.min(Math.max(point.y, 0), 1) * win.innerHeight;
    const hit = doc.elementFromPoint(x, y);
    if (!hit || hit === doc.documentElement || hit === doc.body) return { ok: false, reason: 'no-element' };
    return { ok: true, element: describeElement(hit) };
  } catch {
    return { ok: false, reason: 'cross-origin' };
  }
}
