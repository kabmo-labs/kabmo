/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Files panel harness's drag gestures, as a sequence of real DOM events.
 *
 * Split from `file-explorer.test-util.ts` (which is at the repository's line
 * ceiling) and kept beside the disk double because the two answer the same
 * question: a drag is only meaningful against a directory model that can move
 * an entry. Three gestures are what the panel's specs drive it with:
 *
 * - **`dragRow`** — start on a row, drop on a row or the background.
 * - **`hoverRow`** — start, hover an accepting row, and STOP. A hovered
 *   collapsed chain UNFOLDS, so the level it exposes is a row only afterwards;
 *   a spec that drags straight to that level would be aiming at a row that did
 *   not exist when the gesture began.
 * - **`releaseDrag`** — let go without dropping anywhere.
 *
 * A real `DataTransfer` does not exist in happy-dom, and the handlers read only
 * `setData`/`getData`/`dropEffect`, so a minimal stand-in is what the event
 * carries — without it the row's `dragstart` handler would throw on `setData`.
 */

import { act } from 'preact/test-utils';

/** The shape the row handlers read off `event.dataTransfer`. */
export interface StubTransfer {
  data: Record<string, string>;
  effectAllowed: string;
  dropEffect: string;
  types: string[];
  setData: (type: string, value: string) => void;
  getData: (type: string) => string;
}

/** The transfer object the drag handlers read (happy-dom has no `DataTransfer`). */
export function transferOf(): StubTransfer {
  return {
    data: {} as Record<string, string>,
    effectAllowed: '',
    dropEffect: '',
    types: [] as string[],
    setData(type: string, value: string) {
      this.data[type] = value;
    },
    getData(type: string) {
      return this.data[type] ?? '';
    },
  };
}

/**
 * Dispatch one drag action inside `act`, then let the render it queued settle.
 *
 * `passes` is how many empty turns the caller needs afterwards — the panel's own
 * drag path is synchronous, so this is a flush, not a wait.
 */
export async function settleDrag(dispatch: () => void, passes: number): Promise<void> {
  await act(async () => {
    dispatch();
  });
  for (let i = 0; i < passes; i += 1) await act(async () => {});
}

/** Dispatch one drag event carrying the stub transfer. */
export function fireDrag(element: HTMLElement, type: string, transfer: StubTransfer): Event {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: transfer });
  element.dispatchEvent(event);
  return event;
}

/**
 * The element carrying a row's handlers, found by the row's visible text.
 *
 * The deepest `div` whose own text is exactly the name is the row's inner
 * content, and the element that CLOSES over `[draggable]` is the handler row —
 * dispatching on the wrapper would bubble past the row into the panel
 * background, which is a different drop target.
 */
export function rowElementFor(container: HTMLElement, name: string): HTMLElement {
  const matches = [...container.querySelectorAll('div')].filter((el) => el.textContent?.trim() === name);
  const inner = matches[matches.length - 1];
  if (!inner) throw new Error(`no row named ${name}`);
  return (inner.closest('[draggable]') as HTMLElement | null) ?? (inner.parentElement as HTMLElement);
}
