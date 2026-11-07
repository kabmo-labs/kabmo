/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The composer's model selection on an ACP harness.
 *
 * The two catalogs share no ids: omp's registry has never heard of `opus`, and
 * resolving against it left the composer showing an omp model while the chat
 * ran a different agent. The harness's own list is the whole catalog, and its
 * `thought_level` ladder is what enables the thinking picker.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useModelSelection, type ModelSelection } from '@/client/hooks/chat/composer/model-selection';
import type { AIModelOption } from '@/shared/types';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event'] as const;
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
const originalFetch = Bun.fetch;
let container: HTMLElement | undefined;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in native)) native[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  // A scoped selection never reads `/api/models`; the one case that does must
  // not reach a real server (and must not hang waiting for one).
  target.fetch = (async () => new Response(JSON.stringify({ modelList: [], models: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })) as unknown as typeof fetch;
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (native[key] === undefined) delete target[key];
    else target[key] = native[key];
  }
  target.fetch = originalFetch;
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

const CLAUDE_MODELS: AIModelOption[] = [
  { id: 'default', name: 'default', provider: 'claude', thinkingLevels: ['low', 'high'] },
  { id: 'opus', name: 'opus', provider: 'claude', thinkingLevels: ['low', 'high'] },
];

function mount(options: {
  sessionModel: { provider: string; modelId: string } | null;
  sessionThinkingLevel?: string | null;
  scopedModels?: AIModelOption[] | null;
}): { selection: ModelSelection; mirror: { current: { provider: string; modelId: string; thinkingLevel: string } | null } } {
  const mirror = { current: null as { provider: string; modelId: string; thinkingLevel: string } | null };
  const deferred = { current: null };
  let selection: ModelSelection | null = null;
  function Probe() {
    selection = useModelSelection({
      composerModelRef: mirror,
      sessionModel: options.sessionModel,
      sessionThinkingLevel: options.sessionThinkingLevel ?? null,
      deferredComposerPickRef: deferred,
      scopedModels: options.scopedModels ?? CLAUDE_MODELS,
    });
    return null;
  }
  const root = document.createElement('div');
  document.body.appendChild(root);
  container = root;
  act(() => render(h(Probe, {}), root));
  if (!selection) throw new Error('selection hook did not mount');
  return { selection, mirror };
}

describe('useModelSelection on an ACP harness', () => {
  test("resolves the session's model from the agent's own list", () => {
    const { selection, mirror } = mount({
      sessionModel: { provider: 'claude', modelId: 'opus' },
    });
    expect(selection.selectedModel).toMatchObject({ id: 'opus', provider: 'claude' });
    // The send path's queue snapshot reads this mirror, not state.
    expect(mirror.current).toMatchObject({ provider: 'claude', modelId: 'opus' });
  });

  test('offers the agent’s thinking ladder instead of an empty selector', () => {
    const { selection } = mount({
      sessionModel: { provider: 'claude', modelId: 'opus' },
      sessionThinkingLevel: 'high',
    });
    expect(selection.thinkingLevels).toEqual(['low', 'high']);
    expect(selection.selectedModel?.thinkingLevel).toBe('high');
  });

  test('a session with no model yet starts on the first row the agent lists', () => {
    const { selection } = mount({ sessionModel: null });
    expect(selection.selectedModel?.id).toBe('default');
  });
});
