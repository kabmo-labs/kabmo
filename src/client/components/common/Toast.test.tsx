/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The toast card's own lifecycle, and the one host that draws it.
 *
 * The bugs these cases pin, each one visible in the previous component:
 *
 * - **The countdown restarted on every parent render.** The old `useEffect`
 *   listed `onDismiss` in its deps, and `dismissToast` was a fresh closure per
 *   render of `useToasts` — so a chat re-rendering on every streamed frame kept
 *   its toast on screen indefinitely. The card reads a duration fixed at push
 *   time and a stable module `onDismiss`.
 * - **The card vanished under the pointer.** Hovering or focusing it now pauses
 *   the countdown, and leaving resumes the exact remainder.
 * - **Two live toasts were painted in the same place.** Each card used to be its
 *   own `fixed bottom-4 right-4` portal; the stack is one column, so a second
 *   card pushes the first up instead of covering it.
 * - **An error drew a check mark.** The tone picks both the icon and the live
 *   region — `alert` for a failure.
 */

import { afterAll, afterEach, beforeAll, describe, expect, jest, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { Toast } from '@/client/components/common/Toast';
import { ToastStack } from '@/client/components/common/ToastStack';
import { pushToast, resetToasts } from '@/client/hooks/ui/toasts';
import { TOAST_EXIT_MS } from '@/shared/lib/ui/toast-duration';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;
let win: Window;

beforeAll(() => {
  win = new Window({ url: 'http://localhost' });
  installDomGlobals(win);
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
  // Toasts portal into `document.body`, and the queue is module state that
  // outlives the render, so both are cleared between cases.
  document.body.replaceChildren();
  resetToasts();
  jest.useRealTimers();
});

afterAll(() => {
  restoreDomGlobals();
});

function mount(node: h.JSX.Element): HTMLElement {
  container = document.createElement('div');
  document.body.append(container);
  act(() => render(node, container));
  return container;
}

/** Flush the enter frame and any queued microtasks without a real clock. */
async function settle(): Promise<void> {
  await act(async () => {});
}

function advance(ms: number): void {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

/** The rendered card, wherever the portal put it. */
function card(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[role="status"], [role="alert"]');
  if (!found) throw new Error('no toast card rendered');
  return found;
}

function mountCard(duration: number | null, onDismiss: (id: number) => void = () => {}) {
  return mount(
    h(Toast, {
      toast: { id: 7, message: 'Synced with upstream', type: 'success', duration },
      onDismiss,
    }),
  );
}

describe('Toast', () => {
  test('dismisses itself after exactly the duration it was given', async () => {
    jest.useFakeTimers();
    const dismissed: number[] = [];
    mountCard(1000, (id) => dismissed.push(id));
    await settle();

    advance(999);
    expect(dismissed).toEqual([]);

    advance(1);
    // The exit transition still has to play before the row is removed.
    expect(dismissed).toEqual([]);
    advance(TOAST_EXIT_MS);
    expect(dismissed).toEqual([7]);
  });

  test('a null duration never fires on its own', async () => {
    jest.useFakeTimers();
    const dismissed: number[] = [];
    mountCard(null, (id) => dismissed.push(id));
    await settle();

    advance(120_000);
    expect(dismissed).toEqual([]);
  });

  test('hovering pauses the countdown and leaving resumes the remainder', async () => {
    jest.useFakeTimers();
    const dismissed: number[] = [];
    mountCard(1000, (id) => dismissed.push(id));
    await settle();

    advance(400);
    act(() => {
      card().dispatchEvent(new win.PointerEvent('pointerenter') as unknown as Event);
    });

    // Ten seconds of hovering is not ten seconds off the clock.
    advance(10_000);
    expect(dismissed).toEqual([]);

    act(() => {
      card().dispatchEvent(new win.PointerEvent('pointerleave') as unknown as Event);
    });
    advance(599);
    expect(dismissed).toEqual([]);
    advance(1);
    // The exit transition is its own timer, scheduled now — a single advance that
    // covers both would miss it, because it is created after the window closed.
    advance(TOAST_EXIT_MS);
    expect(dismissed).toEqual([7]);
  });

  test('focus inside the card pauses, and focus leaving it resumes', async () => {
    jest.useFakeTimers();
    const dismissed: number[] = [];
    mount(
      h(Toast, {
        toast: {
          id: 8,
          message: 'Stopped.',
          type: 'success',
          duration: 1000,
          action: { label: 'Send now', onClick: () => {} },
        },
        onDismiss: (id) => dismissed.push(id),
      }),
    );
    await settle();

    act(() => {
      card().dispatchEvent(new win.FocusEvent('focus') as unknown as Event);
    });
    advance(30_000);
    expect(dismissed).toEqual([]);

    act(() => {
      card().dispatchEvent(new win.FocusEvent('blur') as unknown as Event);
    });
    advance(1000);
    advance(TOAST_EXIT_MS);
    expect(dismissed).toEqual([8]);
  });

  test('the close button dismisses without waiting for the timer', async () => {
    jest.useFakeTimers();
    const dismissed: number[] = [];
    mountCard(60_000, (id) => dismissed.push(id));
    await settle();

    const close = card().querySelector<HTMLButtonElement>('button[aria-label="Dismiss notification"]');
    if (!close) throw new Error('no close control');
    act(() => close.click());
    advance(TOAST_EXIT_MS);
    expect(dismissed).toEqual([7]);
  });

  test('an action button runs its handler and then closes the card', async () => {
    jest.useFakeTimers();
    let ran = 0;
    const dismissed: number[] = [];
    mount(
      h(Toast, {
        toast: {
          id: 9,
          message: 'Stopped. 2 messages still queued.',
          type: 'success',
          duration: null,
          action: { label: 'Send now', onClick: () => { ran += 1; } },
        },
        onDismiss: (id) => dismissed.push(id),
      }),
    );
    await settle();

    const action = [...card().querySelectorAll('button')].find((node) => node.textContent === 'Send now');
    if (!action) throw new Error('no action button');
    act(() => action.click());
    expect(ran).toBe(1);
    advance(TOAST_EXIT_MS);
    expect(dismissed).toEqual([9]);
  });

  test('a parent re-render does not restart the countdown', async () => {
    jest.useFakeTimers();
    const dismissed: number[] = [];
    const toast = { id: 11, message: 'Streaming chat toast', type: 'error' as const, duration: 1000 };
    // The old card listed `onDismiss` in its effect deps, and every host passed
    // a fresh closure — so a chat re-rendering per streamed frame pushed the
    // deadline out on each frame. A new callback identity mid-count is exactly
    // that shape; it must not buy the card more time.
    const Host = ({ tick }: { tick: number }) =>
      h('span', null, String(tick), h(Toast, { toast, onDismiss: (id) => dismissed.push(id) }));
    const rerender = (tick: number) => {
      act(() => render(h(Host, { tick }), container));
    };

    container = document.createElement('div');
    document.body.append(container);
    rerender(0);
    await settle();

    advance(400);
    rerender(1);
    advance(400);
    rerender(2);
    expect(dismissed).toEqual([]);

    advance(200);
    advance(TOAST_EXIT_MS);
    expect(dismissed).toEqual([11]);
  });

  test('a failure is an alert, a confirmation is a status', async () => {
    mountCard(3000);
    expect(card().getAttribute('role')).toBe('status');
    expect(card().getAttribute('aria-live')).toBe('polite');

    render(null, container);
    document.body.replaceChildren();
    mount(
      h(Toast, {
        toast: { id: 2, message: 'Save failed', type: 'error', duration: 5000 },
        onDismiss: () => {},
      }),
    );
    expect(card().getAttribute('role')).toBe('alert');
    expect(card().getAttribute('aria-live')).toBe('assertive');
  });
});

describe('ToastStack', () => {
  test('draws nothing until there is something to say', () => {
    mount(h(ToastStack, {}));
    expect(document.querySelector('[data-toast-stack]')).toBeNull();
  });

  test('a second toast stacks beside the first instead of covering it', async () => {
    mount(h(ToastStack, {}));
    act(() => {
      pushToast('first', 'success');
      pushToast('second', 'error');
    });
    await settle();

    const cards = [...document.querySelectorAll('[data-toast-stack] > div')];
    expect(cards).toHaveLength(2);
    expect(cards[0]?.textContent).toContain('first');
    expect(cards[1]?.textContent).toContain('second');
  });

  test('the host follows the queue as toasts come and go', async () => {
    jest.useFakeTimers();
    mount(h(ToastStack, {}));
    act(() => pushToast('only one', 'success'));
    await settle();
    expect(document.querySelectorAll('[data-toast-stack] > div')).toHaveLength(1);

    const close = document.querySelector<HTMLButtonElement>('[data-toast-stack] button[aria-label="Dismiss notification"]');
    if (!close) throw new Error('no close control');
    act(() => close.click());
    advance(TOAST_EXIT_MS);
    expect(document.querySelectorAll('[data-toast-stack] > div')).toHaveLength(0);
  });
});
