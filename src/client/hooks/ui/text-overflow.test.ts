/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Truncation measurement contract. The bug this hook replaces was a character
 * count standing in for a width: 76 characters fit a desktop timeline and were
 * clipped on a 340px phone card, so the notice rendered an ellipsis and shipped
 * a disabled button — the chevron was dropped with it, and the tap did nothing.
 *
 * happy-dom does no layout, so `scrollWidth`/`clientWidth` are faked on the
 * element exactly as the scroll tests fake container geometry.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { h as PreactH, render as PreactRender } from 'preact';
import type { act as PreactAct } from 'preact/test-utils';
import type { RefObject } from 'preact';
import type { useIsTruncated as UseIsTruncated } from '@/client/hooks/ui/text-overflow';

let useIsTruncated: typeof UseIsTruncated;
let h: typeof PreactH;
let render: typeof PreactRender;
let act: typeof PreactAct;

let win: Window;

/** Box the hook measures. `clientWidth` is faked, so no layout is needed. */
class StubResizeObserver {
  static latest: StubResizeObserver | null = null;
  constructor(private readonly callback: () => void) {
    StubResizeObserver.latest = this;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  fire() { this.callback(); }
}

function installBox(el: HTMLElement, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(el, 'scrollWidth', { get: () => scrollWidth, configurable: true });
  Object.defineProperty(el, 'clientWidth', { get: () => clientWidth, configurable: true });
}

interface ProbeProps {
  content: string;
  seen: { current: boolean | null };
  /** Not named `ref`: Preact strips that key from props. */
  targetRef: RefObject<HTMLSpanElement | null>;
  /** When false the truncated row is not rendered — the expanded state. */
  show?: boolean;
}

function Probe(props: ProbeProps) {
  props.seen.current = useIsTruncated(props.targetRef, props.content);
  if (props.show === false) return h('span', null, 'expanded body');
  return h('span', { ref: props.targetRef, className: 'truncate' }, props.content);
}

async function mount(content: string): Promise<{
  seen: { current: boolean | null };
  ref: RefObject<HTMLSpanElement | null>;
  node: HTMLDivElement;
  el: HTMLSpanElement;
}> {
  const seen: { current: boolean | null } = { current: null };
  const ref: RefObject<HTMLSpanElement | null> = { current: null };
  const node = document.createElement('div');
  document.body.appendChild(node);
  await act(async () => { render(h(Probe, { content, seen, targetRef: ref }), node); });
  return { seen, ref, node, el: ref.current! };
}

beforeAll(async () => {
  win = new Window({ url: 'http://localhost' });
  for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'ResizeObserver'] as const) {
    (globalThis as Record<string, unknown>)[key] = (win as unknown as Record<string, unknown>)[key];
  }
  (globalThis as Record<string, unknown>).ResizeObserver = StubResizeObserver;
  // Static imports cannot work here: Preact binds its environment at module
  // evaluation time, so the modules below must load after those DOM globals.
  ({ useIsTruncated } = await import('@/client/hooks/ui/text-overflow'));
  ({ h, render } = await import('preact'));
  ({ act } = await import('preact/test-utils'));
});

afterAll(() => {
  for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'ResizeObserver']) {
    delete (globalThis as Record<string, unknown>)[key];
  }
});

describe('useIsTruncated', () => {
  test('reports a clipped line even when it is short', async () => {
    // The regression: 76 characters, clipped on a phone card. A character
    // threshold called this "fits" and the expander was never offered.
    const probe = await mount('Multi-step reasoning: think carefully through the problem before responding.');
    installBox(probe.el, 480, 254);
    await act(async () => { StubResizeObserver.latest!.fire(); });

    expect(probe.seen.current).toBe(true);
    render(null, probe.node);
    probe.node.remove();
  });

  test('reports a fitting line as not truncated', async () => {
    const probe = await mount('Late LSP diagnostics arrived after the edit returned:');
    installBox(probe.el, 335, 335);
    await act(async () => { StubResizeObserver.latest!.fire(); });

    expect(probe.seen.current).toBe(false);
    render(null, probe.node);
    probe.node.remove();
  });

  test('keeps the last answer when the element has no layout to measure', async () => {
    // An unmeasured element reports 0 for both values, which is not "fits" —
    // treating it as one would retract the expander mid-interaction.
    const probe = await mount('clipped');
    installBox(probe.el, 500, 200);
    await act(async () => { StubResizeObserver.latest!.fire(); });
    expect(probe.seen.current).toBe(true);

    installBox(probe.el, 0, 0);
    await act(async () => { StubResizeObserver.latest!.fire(); });
    expect(probe.seen.current).toBe(true);

    render(null, probe.node);
    probe.node.remove();
  });

  test('keeps its answer when the truncated row is replaced by the expanded body', async () => {
    // Expanding swaps the truncated row out for the body, so the ref detaches
    // while the answer is still the reason the expander is on screen. A reset
    // there would collapse the card the user just opened.
    const probe = await mount('clipped');
    installBox(probe.el, 500, 200);
    await act(async () => { StubResizeObserver.latest!.fire(); });
    expect(probe.seen.current).toBe(true);

    // Detached AND with new content, so the effect re-runs against a null ref.
    await act(async () => {
      render(h(Probe, { content: 'clipped and expanded', seen: probe.seen, targetRef: probe.ref, show: false }), probe.node);
    });
    expect(probe.seen.current).toBe(true);

    render(null, probe.node);
    probe.node.remove();
  });
});
