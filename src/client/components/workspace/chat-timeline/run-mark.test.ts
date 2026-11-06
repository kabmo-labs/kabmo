/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two surfaces that name WHICH agent is working.
 *
 * Both used to hardcode `lucide`'s `Bot`, so an `opencode` or `claude` chat
 * announced itself as omp in the one row the user watches while waiting. The
 * assertions are on the MARK (`data-harness`), not on colours, because
 * happy-dom paints nothing — but the fallback matters as much: a session with
 * no harness, or one this build cannot name, must still draw a mark rather than
 * an empty square.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { GeneratingIndicator } from '@/client/components/workspace/chat-timeline/GeneratingIndicator';
import { AiMessageFooter } from '@/client/components/workspace/chat-timeline/AiMessageFooter';
import { RunFooter } from '@/client/components/workspace/chat-timeline/RunFooter';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;

beforeAll(() => installDomGlobals(new Window({ url: 'http://localhost' })));
afterAll(() => restoreDomGlobals());

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

function mount(node: preact.ComponentChild): HTMLElement {
  act(() => {
    render(node, container);
  });
  return container;
}

function cleanup(): void {
  render(null, container);
  container.remove();
}

describe('GeneratingIndicator mark', () => {
  test('draws the running harness mark, not a generic robot', () => {
    const el = mount(h(GeneratingIndicator, { harness: 'opencode', modelName: 'gpt-5', provider: 'openai' }));
    // The badge's SVG is tagged with the BRAND key, and the wrapper with the id.
    expect(el.querySelector('svg[data-harness="opencode"]')).not.toBeNull();
    expect(el.querySelector('[data-harness="opencode"]')).not.toBeNull();
    cleanup();
  });

  test("omp's own mark for the default harness", () => {
    const el = mount(h(GeneratingIndicator, { harness: 'omp-rpc', modelName: 'DeepSeek V4 Flash' }));
    expect(el.querySelector('svg[data-harness="omp"]')).not.toBeNull();
    cleanup();
  });

  test('an unknown or absent harness keeps a mark instead of an empty badge', () => {
    for (const harness of [undefined, '', 'some-future-agent']) {
      const el = mount(h(GeneratingIndicator, { ...(harness ? { harness } : {}), modelName: 'm', provider: 'p' }));
      const badge = el.querySelector('.generating-mark-ring')?.nextElementSibling;
      expect(badge, `no badge for ${String(harness)}`).not.toBeNull();
      expect(badge!.querySelector('svg'), `no mark for ${String(harness)}`).not.toBeNull();
      expect(el.querySelector('svg[data-harness]'), `${String(harness)} drew a harness claim`).toBeNull();
      cleanup();
    }
  });
});

describe('answer footer mark', () => {
  test('the desktop strip draws the harness that wrote the answer', () => {
    const el = mount(h(AiMessageFooter, { currentModel: 'sonnet', content: 'ok', msgId: 'm1', harness: 'claude' }));
    expect(el.querySelector('svg[data-harness="claudecode"]')).not.toBeNull();
    cleanup();
  });

  test('the phone strip draws it too, from the same props', () => {
    const el = mount(h(AiMessageFooter, { currentModel: 'sonnet', content: 'ok', msgId: 'm2', harness: 'codex', isMobile: true }));
    expect(el.querySelector('svg[data-harness="codex"]')).not.toBeNull();
    cleanup();
  });

  test('a footer with no harness still draws a mark', () => {
    const el = mount(h(AiMessageFooter, { currentModel: 'sonnet', content: 'ok', msgId: 'm3' }));
    expect(el.querySelector('svg')).not.toBeNull();
    expect(el.querySelector('svg[data-harness]')).toBeNull();
    cleanup();
  });

  test('RunFooter forwards the run harness to the strip', () => {
    const el = mount(h(RunFooter, {
      msg: { id: 'ai-1', role: 'ai', content: 'answer', model: 'gpt-5', provider: 'openai' },
      harness: 'opencode',
    }));
    expect(el.querySelector('svg[data-harness="opencode"]')).not.toBeNull();
    cleanup();
  });
});
