/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The scroll-restore contract, which no other test can see: a component test
 * asserts markup, and this behaviour is a `scrollTop` written into a shared
 * container whose document was just swapped.
 *
 * Four properties are pinned, and each one is a bug this could ship with:
 *
 * - the stored offset is applied when the tab opens, and RE-applied while the
 *   document's height is still moving (a long file's geometry lands a frame
 *   later, so a single write is clamped to the height that existed then);
 * - a reader's own scroll WINS over a pending restore, because fighting the
 *   wheel for the rest of the window is worse than a missed restore;
 * - the offset is recorded from the reader's SCROLL EVENTS, never by reading the
 *   element on the way out — a layout effect's cleanup runs after the DOM
 *   already holds the next tab's document, so reading there stores the new
 *   file's offset under the old tab's key;
 * - a caller with no session (the shared diff views also draw a chat tool card)
 *   gets an inert hook instead of a thrown context error.
 *
 * Rendered with `h()` against happy-dom; geometry is faked, since happy-dom
 * does no layout.
 */

import { afterAll, afterEach, beforeAll, describe, expect, jest, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { SessionStateProvider } from '@/client/components/common/session-state-provider/index';
import { useScrollRestore } from '@/client/hooks/editor/use-scroll-restore';
import { forgetSession, getSessionValue } from '@/shared/lib/workspace/session-state/store';
import { SCROLL_POSITIONS_KEY, type ScrollPositions } from '@/shared/lib/workspace/scroll-positions';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const SESSION = 'new-scroll-restore';
const nativeFetch = Bun.fetch;
let container: HTMLElement;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
  forgetSession(SESSION);
  (globalThis as unknown as Record<string, unknown>).fetch = nativeFetch;
});

afterAll(() => {
  restoreDomGlobals();
});

/** What the provider's blob load reads: the offsets this suite pre-seeded. */
let stored: Record<string, unknown> = {};

/** Install the session-state fetch stub (the provider reads `/state` on mount). */
function stubStateFetch(): void {
  (globalThis as unknown as Record<string, unknown>).fetch = async (input: unknown) => {
    const url = String(input);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('/state')) return json({ sessionId: SESSION, state: stored });
    return json({});
  };
}

/** A scroller whose geometry the test drives. */
interface ProbeHandle {
  el: HTMLElement;
  /** Set the document height the container can scroll through. */
  setHeight(height: number): void;
}

function installGeometry(el: HTMLElement): { setHeight: (height: number) => void } {
  const geometry = { height: 5000, viewport: 500, top: 0 };
  Object.defineProperty(el, 'scrollHeight', { get: () => geometry.height, configurable: true });
  Object.defineProperty(el, 'clientHeight', { get: () => geometry.viewport, configurable: true });
  Object.defineProperty(el, 'scrollTop', {
    get: () => geometry.top,
    set: (value: number) => {
      geometry.top = Math.max(0, Math.min(value, Math.max(0, geometry.height - geometry.viewport)));
      el.dispatchEvent(new Event('scroll'));
    },
    configurable: true,
  });
  return {
    setHeight: (height: number) => {
      geometry.height = height;
    },
  };
}

/** A ResizeObserver the test fires by hand — the hook observes its content box. */
class StubResizeObserver {
  static instances: StubResizeObserver[] = [];
  static latest(): StubResizeObserver {
    return StubResizeObserver.instances[StubResizeObserver.instances.length - 1];
  }
  constructor(private readonly callback: () => void) {
    StubResizeObserver.instances.push(this);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  fire(): void {
    this.callback();
  }
}

/** The hook under test, on one tab + surface, with its scroller mounted. */
function Probe({ tabKey, surface }: { tabKey: string | null; surface: 'code' | 'rendered' }) {
  const scroll = useScrollRestore({ tabKey, surface });
  return h('div', { ref: scroll.ref, onScroll: scroll.onScroll }, h('div', { class: 'content' }));
}

/** Mount the hook inside a provider, over the stored blob. */
async function mount(
  tabKey: string | null,
  surface: 'code' | 'rendered' = 'code',
  offsets: ScrollPositions = {},
  documentHeight = 5000,
): Promise<ProbeHandle> {
  stored = { [SCROLL_POSITIONS_KEY]: offsets };
  stubStateFetch();
  StubResizeObserver.instances = [];
  (globalThis as unknown as Record<string, unknown>).ResizeObserver = StubResizeObserver;

  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(
      h(SessionStateProvider, {
        sessionId: SESSION,
        children: h(Probe, { tabKey, surface }),
      }),
      container,
    );
  });
  // The provider's blob load settles across a tick; the restore it drives is
  // what the first assertion depends on.
  for (let i = 0; i < 10; i += 1) await act(async () => {});

  const el = container.querySelector('div') as HTMLElement;
  const geometry = installGeometry(el);
  // The geometry lands AFTER the mount's own restore attempt (happy-dom has no
  // layout), so re-run it the way the document's own growth would.
  geometry.setHeight(documentHeight);
  await act(async () => {
    StubResizeObserver.latest()?.fire();
  });
  return { el, setHeight: geometry.setHeight };
}

function storedOffsets(): ScrollPositions | undefined {
  return getSessionValue<ScrollPositions>(SESSION, SCROLL_POSITIONS_KEY);
}

/**
 * A READER's scroll: the input that causes it, then the movement.
 *
 * The hook distinguishes the two, and it has to: a `scroll` with no input behind
 * it is the browser re-anchoring the document as its real height lands, which
 * must NOT be read as the reader moving. `wheel` is the simplest input a code
 * surface sees.
 */
function readerScroll(probe: ProbeHandle, top: number): void {
  probe.el.dispatchEvent(new Event('wheel', { bubbles: true }));
  probe.el.scrollTop = top;
}

describe('useScrollRestore', () => {
  test('restores the stored offset for the tab and surface', async () => {
    const probe = await mount('7', 'code', { '7': { code: 900 } });
    expect(probe.el.scrollTop).toBe(900);
  });

  test('re-applies while the document is still growing', async () => {
    // A container that cannot yet reach the target: the first write clamps to
    // its own bottom, which is the shape a long file's geometry lands in.
    const probe = await mount('7', 'code', { '7': { code: 900 } }, 600);
    expect(probe.el.scrollTop).toBe(100);
    probe.setHeight(5000);
    await act(async () => {
      StubResizeObserver.latest()?.fire();
    });
    expect(probe.el.scrollTop).toBe(900);
  });

  test("a reader's own scroll wins over a pending restore", async () => {
    const probe = await mount('7', 'code', { '7': { code: 900 } });
    readerScroll(probe, 120);
    await act(async () => {
      StubResizeObserver.latest()?.fire();
    });
    expect(probe.el.scrollTop).toBe(120);
  });

  test('the document re-anchoring is not the reader, and the restore re-applies', async () => {
    // The bug the e2e spec found: the restore writes 900, the document's real
    // height lands a frame later, and CodeMirror re-anchors to keep the visible
    // content stable — `scrollTop` moves to 420 with nobody assigning. Reading
    // that as the reader's own scroll dropped the pending restore, so the
    // anchored value became where the reader stayed (measured: opening a tab
    // moved them 29 lines) and the wrong offset was persisted.
    const probe = await mount('7', 'code', { '7': { code: 900 } }, 600);
    expect(probe.el.scrollTop).toBe(100);

    // The browser's own correction: no input event behind it.
    probe.el.scrollTop = 420;
    probe.setHeight(5000);
    await act(async () => {
      StubResizeObserver.latest()?.fire();
    });

    // The restore is still in charge, so the reader lands where the session
    // recorded — not where the anchoring put them.
    expect(probe.el.scrollTop).toBe(900);
  });

  test('a reader’s scroll is still theirs after an anchoring correction', async () => {
    // The discriminator must not swallow the NEXT real scroll: the input that
    // explains a movement is consumed by it, so a reader who scrolls after the
    // document settles keeps their own position.
    const probe = await mount('7', 'code', { '7': { code: 900 } });
    probe.el.scrollTop = 420; // anchoring, no input
    await act(async () => {
      StubResizeObserver.latest()?.fire();
    });
    expect(probe.el.scrollTop).toBe(900);

    readerScroll(probe, 120);
    await act(async () => {
      StubResizeObserver.latest()?.fire();
    });
    expect(probe.el.scrollTop).toBe(120);
  });

  test('the reader’s offset is persisted, and the tab key is what it is stored under', async () => {
    const probe = await mount('7', 'code', {});
    jest.useFakeTimers();
    try {
      readerScroll(probe, 350);
      jest.advanceTimersByTime(200);
      await act(async () => {});
    } finally {
      jest.useRealTimers();
    }
    expect(storedOffsets()?.['7']?.code).toBe(350);
  });

  test('no tab key remembers nothing', async () => {
    const probe = await mount(null, 'code', {});
    expect(probe.el.scrollTop).toBe(0);
    jest.useFakeTimers();
    try {
      probe.el.scrollTop = 200;
      jest.advanceTimersByTime(200);
      await act(async () => {});
    } finally {
      jest.useRealTimers();
    }
    // The stored map is untouched: no entry was minted for a null key.
    expect(storedOffsets()).toEqual({});
  });

  test('a different surface reads its own offset', async () => {
    const probe = await mount('7', 'rendered', { '7': { code: 900, rendered: 42 } });
    expect(probe.el.scrollTop).toBe(42);
  });

  test('a caller with no session gets an inert hook, not a context error', async () => {
    // No provider: the shared diff views draw a chat tool card this way.
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      render(h(Probe, { tabKey: '7', surface: 'code' }), container);
    });
    const el = container.querySelector('div') as HTMLElement;
    expect(el).not.toBeNull();
    installGeometry(el);
    el.scrollTop = 300;
    await act(async () => {});
    expect(el.scrollTop).toBe(300);
  });
});
