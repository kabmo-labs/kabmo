/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Harness for the timeline-scroll specs, shared by `scroll.test.ts` and
 * `scroll-reading-back.test.ts`.
 *
 * Runs against a real DOM (happy-dom) because these are Preact hooks; geometry
 * is faked on the container, since happy-dom does no layout. Preact binds its
 * environment at module evaluation time, so every Preact/hook module is loaded
 * DYNAMICALLY after the DOM globals exist — a static import would evaluate
 * against the real (or missing) DOM and the hooks would observe nothing.
 *
 * The harness is a factory rather than module-level setup because two spec
 * files share one `bun test` process: each installs its own globals in
 * `beforeAll` and removes them in `afterAll`.
 */

import { Window } from 'happy-dom';
import type { h as PreactH, render as PreactRender } from 'preact';
import type { act as PreactAct } from 'preact/test-utils';
import type {
  useChatTimelineScroll as UseScroll,
  ChatTimelineScrollResult,
} from '@/client/hooks/chat/timeline/scroll';
import type { useTimelineAutoScroll as UseAuto } from '@/client/hooks/chat/timeline/auto-scroll';
import type { ChatMessageData } from '@/shared/types';

export interface ScrollGeometry {
  top: number;
  height: number;
  viewport: number;
}

export interface ScrollRecord {
  top: number;
  behavior?: ScrollBehavior;
}

export interface ProbeHandle {
  holder: { current: ChatTimelineScrollResult | null };
  node: HTMLDivElement;
  el: HTMLDivElement;
}

interface ProbeProps {
  sessionId: string;
  messages: ChatMessageData[];
  /** Holder owned by ONE test: a stale tree can only write its own hook result. */
  holder: { current: ChatTimelineScrollResult | null };
}

/** ResizeObserver the tests drive by hand — the hook rebuilds one per content
 *  node, so the last instance of the current mount is the live one. */
export class StubResizeObserver {
  static instances: StubResizeObserver[] = [];
  static latest(): StubResizeObserver {
    return StubResizeObserver.instances[StubResizeObserver.instances.length - 1];
  }
  constructor(private readonly callback: () => void) {
    StubResizeObserver.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  fire() {
    this.callback();
  }
}

export interface ScrollProbe {
  /** Live geometry the fake scroller reports. */
  geometry: ScrollGeometry;
  /** Every scroll the hook asked for, in order. */
  scrolled: ScrollRecord[];
  StubResizeObserver: typeof StubResizeObserver;
  /** Preact's test-utils `act`, loaded after the DOM globals exist. */
  act: typeof PreactAct;
  /** Drain the deferred frames the hook scheduled. */
  flushFrames(): Promise<void>;
  message(id: string): ChatMessageData;
  mountProbe(sessionId: string, messages: ChatMessageData[]): Promise<ProbeHandle>;
  updateProbe(probe: ProbeHandle, sessionId: string, messages: ChatMessageData[]): Promise<void>;
  unmountProbe(probe: ProbeHandle): Promise<void>;
  /** Remove the DOM globals this harness installed. */
  teardown(): void;
}

export async function setupScrollProbe(): Promise<ScrollProbe> {
  const win = new Window({ url: 'http://localhost' });
  const keys = [
    'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event',
  ] as const;
  for (const key of keys) {
    (globalThis as Record<string, unknown>)[key] = (win as unknown as Record<string, unknown>)[key];
  }

  StubResizeObserver.instances = [];
  (globalThis as Record<string, unknown>).ResizeObserver = StubResizeObserver;

  const geometry: ScrollGeometry = { top: 0, height: 5000, viewport: 500 };
  const scrolled: ScrollRecord[] = [];
  /** Frame callbacks the hook's observer deferred; index 0 is handle 1. */
  const pendingFrames: Array<(() => void) | null> = [];

  // The hook defers its resize-driven pin by one frame, and happy-dom's own rAF
  // never runs without a real event loop, so the queue is drained by hand:
  // `flushFrames()` runs whatever a delivery scheduled.
  (globalThis as Record<string, unknown>).requestAnimationFrame = (cb: () => void) => pendingFrames.push(cb);
  (globalThis as Record<string, unknown>).cancelAnimationFrame = (handle: number) => {
    pendingFrames[handle - 1] = null;
  };

  /** Observe what the hook asks for; 'instant' also lands (a smooth scroll would
   *  animate in a browser, so the fake keeps it as a recorded intent only). */
  function applyTop(el: HTMLDivElement, value: number) {
    geometry.top = Math.max(0, Math.min(value, geometry.height - geometry.viewport));
    // The global `Event` the hook's listener expects: happy-dom's, installed
    // into globalThis above.
    el.dispatchEvent(new Event('scroll'));
  }

  function installScroller(el: HTMLDivElement) {
    Object.defineProperty(el, 'scrollHeight', { get: () => geometry.height, configurable: true });
    Object.defineProperty(el, 'clientHeight', { get: () => geometry.viewport, configurable: true });
    Object.defineProperty(el, 'scrollTop', {
      get: () => geometry.top,
      set: (value: number) => applyTop(el, value),
      configurable: true,
    });
    Object.defineProperty(el, 'scrollTo', {
      value: (options: ScrollRecord) => {
        scrolled.push(options);
        if (options.behavior !== 'smooth') applyTop(el, options.top);
      },
      configurable: true,
    });
  }

  // Static imports cannot work here: the modules below must load after the DOM
  // globals are installed (see the module header).
  const { useChatTimelineScroll }: { useChatTimelineScroll: typeof UseScroll } =
    await import('@/client/hooks/chat/timeline/scroll');
  const { useTimelineAutoScroll }: { useTimelineAutoScroll: typeof UseAuto } =
    await import('@/client/hooks/chat/timeline/auto-scroll');
  const { h, render }: { h: typeof PreactH; render: typeof PreactRender } = await import('preact');
  const { act }: { act: typeof PreactAct } = await import('preact/test-utils');

  function Probe(props: ProbeProps) {
    const scroll = useChatTimelineScroll({});
    useTimelineAutoScroll({
      sessionId: props.sessionId,
      messages: props.messages,
      scrollRef: scroll.scrollRef,
      jumpToBottom: scroll.jumpToBottom,
      enabled: true,
    });
    props.holder.current = scroll;
    return h('div', { ref: scroll.scrollRef, onScroll: scroll.handleScroll },
      h('div', { ref: scroll.contentRef }));
  }

  const message = (id: string) => ({ id, role: 'user', content: id } as unknown as ChatMessageData);

  /** Fresh mount, own container: `follow`, the jump counter and the observers
   *  are per-hook state, so sharing them across tests would hide the behaviour. */
  async function mountProbe(sessionId: string, messages: ChatMessageData[]): Promise<ProbeHandle> {
    const holder: ProbeHandle['holder'] = { current: null };
    const node = document.createElement('div');
    document.body.appendChild(node);
    await act(async () => { render(h(Probe, { sessionId, messages, holder }), node); });
    const el = holder.current!.scrollRef.current!;
    installScroller(el);
    return { holder, node, el };
  }

  /** Re-render with new props: a session switch, then that session's history. */
  async function updateProbe(probe: ProbeHandle, sessionId: string, messages: ChatMessageData[]) {
    await act(async () => {
      render(h(Probe, { sessionId, messages, holder: probe.holder }), probe.node);
    });
  }

  async function unmountProbe(probe: ProbeHandle) {
    await act(async () => { render(null, probe.node); });
    probe.node.remove();
  }

  /**
   * Drain the deferred frames. The resize-driven pin is deliberately NOT applied
   * inside the ResizeObserver delivery — a layout write there makes the browser
   * re-run its observers in the same frame, and past its depth limit it reports
   * "ResizeObserver loop completed with undelivered notifications." — so a test
   * that fires an observer has to let the frame it scheduled run before the
   * geometry it asserts on has been applied.
   */
  async function flushFrames() {
    for (let i = 0; i < pendingFrames.length; i++) {
      const callback = pendingFrames[i];
      pendingFrames[i] = null;
      if (!callback) continue;
      await act(async () => { callback(); });
    }
    pendingFrames.length = 0;
  }

  function teardown() {
    for (const key of [...keys, 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      delete (globalThis as Record<string, unknown>)[key];
    }
  }

  return {
    geometry,
    scrolled,
    StubResizeObserver,
    act,
    flushFrames,
    message,
    mountProbe,
    updateProbe,
    unmountProbe,
    teardown,
  };
}
