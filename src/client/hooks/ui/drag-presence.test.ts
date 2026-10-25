/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Drag presence.
 *
 * The rule this replaced was a counter, and the counter is why a drop target
 * could stay lit with the pointer nowhere near it. `dragenter` fires for every
 * nested child the pointer crosses, and the editor's handler incremented on each
 * one while ignoring the matching `dragleave` (a move between children). Measured
 * in Chromium against the real app: five child crossings inside the chat raised
 * the count to six, one exit lowered it to five, and the "Drop a file to open it"
 * overlay stayed on the chat after the gesture ended.
 *
 * These cases pin the symmetric answer — `relatedTarget` — and the backstops for
 * a gesture that never reports its own end to the element.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useDragPresence, type DragPresence } from '@/client/hooks/ui/drag-presence';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event'] as const;
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    native[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (native[key] === undefined) delete target[key];
    else target[key] = native[key];
  }
});

interface Harness {
  api: () => DragPresence;
  /** The bound target, with a child inside it and a sibling outside it. */
  target: HTMLElement;
  child: HTMLElement;
  outside: HTMLElement;
}

let container: HTMLElement;

beforeEach(() => {
  container?.remove();
  container = document.body.appendChild(document.createElement('div'));
});

async function mount(): Promise<Harness> {
  let api: DragPresence | null = null;
  const target = document.createElement('div');
  const child = document.createElement('div');
  target.appendChild(child);
  const outside = document.createElement('div');
  container.append(target, outside);

  const Probe = () => {
    api = useDragPresence();
    return null;
  };
  await act(async () => {
    render(h(Probe, {}), container);
  });

  return { api: () => api!, target, child, outside };
}

/** A `dragleave` as the browser delivers one, with the element being entered. */
function leaveEvent(currentTarget: HTMLElement, relatedTarget: Node | null) {
  return { currentTarget, relatedTarget } as never;
}

describe('useDragPresence', () => {
  test('an enter lights the target and a leave to another element clears it', async () => {
    const harness = await mount();
    expect(harness.api().active).toBe(false);

    await act(async () => { harness.api().enter(); });
    expect(harness.api().active).toBe(true);

    await act(async () => { harness.api().leave(leaveEvent(harness.target, harness.outside)); });
    expect(harness.api().active).toBe(false);
  });

  test('a move between children keeps it lit, however many children are crossed', async () => {
    const harness = await mount();
    await act(async () => { harness.api().enter(); });

    // The shape that broke the counter: enter/leave pairs as the pointer walks
    // across nested children, every leave naming a node still inside.
    for (let pass = 0; pass < 6; pass += 1) {
      await act(async () => { harness.api().enter(); });
      await act(async () => { harness.api().leave(leaveEvent(harness.target, harness.child)); });
    }

    expect(harness.api().active).toBe(true);

    // And one real exit still clears it — the count cannot have drifted.
    await act(async () => { harness.api().leave(leaveEvent(harness.target, harness.outside)); });
    expect(harness.api().active).toBe(false);
  });

  test('a leave with no relatedTarget is an exit, which is how a pointer leaving the window arrives', async () => {
    const harness = await mount();
    await act(async () => { harness.api().enter(); });
    await act(async () => { harness.api().leave(leaveEvent(harness.target, null)); });
    expect(harness.api().active).toBe(false);
  });

  test('a drop anywhere clears it, so a gesture claimed elsewhere leaves nothing lit', async () => {
    const harness = await mount();
    await act(async () => { harness.api().enter(); });
    await act(async () => { window.dispatchEvent(new window.Event('drop')); });
    expect(harness.api().active).toBe(false);
  });

  test('a dragend clears it, which is what a cancelled in-app drag fires', async () => {
    const harness = await mount();
    await act(async () => { harness.api().enter(); });
    await act(async () => { window.dispatchEvent(new window.Event('dragend')); });
    expect(harness.api().active).toBe(false);
  });

  test('a pointer move with no button held clears it, which is the only signal a cancelled OS drag leaves', async () => {
    // Measured in Chromium: an Escape during a real file drag delivers no
    // `dragleave`, no `dragend` and no `keydown` to the page — but the drag
    // suppressed pointer movement for its whole duration, so the first move
    // afterwards is proof the gesture is over.
    const harness = await mount();
    await act(async () => { harness.api().enter(); });

    const move = (buttons: number) => {
      const event = new window.PointerEvent('pointermove', { bubbles: true });
      Object.defineProperty(event, 'buttons', { value: buttons });
      window.dispatchEvent(event);
    };

    // A held button is a drag still in progress (or any other gesture), so the
    // overlay stays.
    await act(async () => { move(1); });
    expect(harness.api().active).toBe(true);

    await act(async () => { move(0); });
    expect(harness.api().active).toBe(false);
  });

  test('an idle page ignores pointer moves entirely', async () => {
    const harness = await mount();
    const event = new window.PointerEvent('pointermove', { bubbles: true });
    Object.defineProperty(event, 'buttons', { value: 0 });
    await act(async () => { window.dispatchEvent(event); });
    expect(harness.api().active).toBe(false);
  });

  test('two mounted targets keep their own state, and one unmounting leaves the other lit', async () => {
    // The chat's drop target and the editor's are mounted at the same time, so a
    // backstop registered once for the module would clear both — and one of them
    // unmounting would remove the other's listener.
    const containerB = document.body.appendChild(document.createElement('div'));
    let first: DragPresence | null = null;
    let second: DragPresence | null = null;
    const A = () => { first = useDragPresence(); return null; };
    const B = () => { second = useDragPresence(); return null; };
    await act(async () => {
      render(h(A, {}), container);
      render(h(B, {}), containerB);
    });

    await act(async () => { first!.enter(); });
    await act(async () => { second!.enter(); });
    expect([first!.active, second!.active]).toEqual([true, true]);

    await act(async () => { render(null, container); });
    expect(second!.active).toBe(true);

    await act(async () => { window.dispatchEvent(new window.Event('dragend')); });
    expect(second!.active).toBe(false);
    containerB.remove();
  });
});
