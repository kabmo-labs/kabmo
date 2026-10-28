/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The tool-call card's plugin renderer, at the HOST level.
 *
 * The slot's contract is that a plugin renderer applies only to a tool the host
 * has no panel for. That rule has two halves and both are asserted here, because
 * only the pair is the property:
 *
 * - a tool the host DOES know (`read`) keeps the host's panel even when a plugin
 *   claimed its name — the plugin must not be able to shadow it;
 * - a tool the host does NOT know renders the plugin's component, and the card's
 *   generic Input / Output body is suppressed so the same facts are not drawn
 *   twice.
 *
 * The negative case (no registration) is the acceptance property: the card
 * renders exactly its own tree.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ToolCallCard } from '@/client/components/workspace/chat-timeline/ToolCallCard';
import { registerListSlot, resetListSlots } from '@/client/lib/plugins/list-slots';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { ToolCallData } from '@/shared/types';

let container: HTMLElement;

beforeEach(() => {
  resetListSlots();
  installDomGlobals(new Window());
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  resetListSlots();
  restoreDomGlobals();
});

afterAll(() => restoreDomGlobals());

function PluginPanel(props: { toolName: string; output?: string }) {
  // The output is carried as an ATTRIBUTE, not as text: the assertions below
  // distinguish the plugin's body from the host's generic Output block by its
  // text, so a probe that echoed the output would blur the two.
  return h('div', { 'data-testid': 'plugin-panel', 'data-tool': props.toolName, 'data-output': props.output ?? '' });
}

const tool = (name: string): ToolCallData => ({
  id: 'call-1',
  type: 'terminal',
  title: name,
  name,
  input: { path: 'a.ts' },
  output: 'some output',
});

function mount(name: string, isOpen = true) {
  act(() => {
    render(h(ToolCallCard, { tool: tool(name), isOpen, defaultExpanded: true }), container);
  });
  return container;
}

describe('ToolCallCard plugin renderer', () => {
  test('renders no plugin panel when nothing was contributed', () => {
    mount('mytool');
    expect(container.querySelector('[data-testid="plugin-panel"]')).toBeNull();
    // The generic body is still there — nothing about this card changed.
    expect(container.textContent).toContain('some output');
  });

  test("renders the plugin's component for a tool the host does not know", () => {
    registerListSlot('demo', 'timelineRenderer', { id: 'mine', tool: 'mytool', component: PluginPanel });
    mount('mytool');

    const panel = container.querySelector('[data-testid="plugin-panel"]');
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute('data-tool')).toBe('mytool');
    // The plugin is handed the call's output, and it OWNS the body: the host's
    // generic Output block must not also render the same facts.
    expect(panel?.getAttribute('data-output')).toBe('some output');
    expect(container.textContent).not.toContain('some output');
  });

  test('a plugin cannot shadow a tool the host has its own panel for', () => {
    registerListSlot('demo', 'timelineRenderer', { id: 'hijack', tool: 'read', component: PluginPanel });
    mount('read');

    // The host's own panel wins; the plugin's component is never built.
    expect(container.querySelector('[data-testid="plugin-panel"]')).toBeNull();
  });

  test('a late registration reaches a mounted card', async () => {
    mount('mytool');
    expect(container.querySelector('[data-testid="plugin-panel"]')).toBeNull();

    await act(async () => {
      registerListSlot('demo', 'timelineRenderer', { id: 'late', tool: 'mytool', component: PluginPanel });
    });
    expect(container.querySelector('[data-testid="plugin-panel"]')).not.toBeNull();
  });
});
