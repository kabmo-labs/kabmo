/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `pendingInteraction` host surface.
 *
 * Three properties, and each one is the answer to a way this slot could hurt the
 * user rather than help them:
 *
 * 1. **A plugin's answer IS a user's answer.** The response a plugin's `submit`
 *    sends is compared against the one the human's own button sends, for the
 *    grouped card and for a single dialog — captured from the real card, not
 *    from a hand-written expectation, so a change to the card's frame shape
 *    fails here instead of reaching omp.
 * 2. **Declining is free.** With no plugin registered the card is compared
 *    byte-for-byte against the same card rendered with no slot in the tree at
 *    all: an empty slot may not add a wrapper, a spacer or an empty group, or a
 *    plugin-less install starts paying for a feature it does not have.
 * 3. **A throwing plugin cannot take the question away.** The human's controls
 *    are outside the plugin boundary, so a plugin that throws while rendering is
 *    replaced by a visible report and the question stays answerable.
 */

import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import type { PendingInteractionProps } from '@kabmo-labs/kabmo-sdk';
import { usePluginId } from '@kabmo-labs/kabmo-ui';
import { AskPanel } from '@/client/components/workspace/chat-timeline/tool-renderers/ask-panel';
import { GroupedAsk } from '@/client/components/workspace/chat-timeline/tool-renderers/ask-panel/GroupedAsk';
import { PluginPendingInteractions } from '@/client/components/workspace/chat-timeline/tool-renderers/ask-panel/PluginPendingInteractions';
import type { ExtensionDialogResponse } from '@/client/components/workspace/chat-timeline/tool-renderers/extension-dialog/Lazy';
import { AskFramesContext, type AskFramesHandle } from '@/client/hooks/chat/timeline/ask-frames';
import { registerListSlot, resetListSlots } from '@/client/lib/plugins/list-slots';
import type { ToolCallData } from '@/shared/types';
import type { ExtensionUiDialogRequest } from '@/shared/types/omp/agent';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const QUESTIONS = [
  {
    id: 'language',
    question: 'Which language?',
    header: 'Language',
    options: [{ label: 'Python', description: 'scripting' }, { label: 'Rust' }],
  },
];

/** The tool call the card is anchored on — omp's `ask` with one question. */
const ASK_TOOL: ToolCallData = {
  id: 'call-ask',
  type: 'other',
  title: 'ask',
  name: 'ask',
  status: 'running',
  input: { questions: QUESTIONS },
};

/** The GROUPED shape: one frame carrying every question, answered by `answers`. */
const GROUPED_FRAME: ExtensionUiDialogRequest = {
  type: 'extension_ui_request',
  id: 'ui-grouped',
  method: 'ask',
  title: '',
  questions: [
    {
      id: 'language',
      question: 'Which language?',
      header: 'Language',
      options: [{ label: 'Python', description: 'scripting' }, { label: 'Rust' }],
    },
  ],
};

/** The per-question shape: one blocking `select`, answered by `value`. */
const SELECT_FRAME: ExtensionUiDialogRequest = {
  type: 'extension_ui_request',
  id: 'ui-select',
  method: 'select',
  title: 'Which language?',
  options: ['Python', 'Rust'],
};

interface Captured {
  request: ExtensionUiDialogRequest;
  response: ExtensionDialogResponse;
}

let container: HTMLElement;
let calls: Captured[];

beforeEach(() => {
  resetListSlots();
  installDomGlobals(new Window());
  container = document.createElement('div');
  document.body.appendChild(container);
  calls = [];
});

afterEach(() => {
  render(null, container);
  container.remove();
  resetListSlots();
  restoreDomGlobals();
});

afterAll(() => restoreDomGlobals());

function mount(tool: ToolCallData, groups: ExtensionUiDialogRequest[][]): void {
  const handle: AskFramesHandle = {
    framesByTool: new Map([[tool.id, groups]]),
    orphanAsks: [],
    respond: (request, response) => calls.push({ request, response }),
  };
  act(() => {
    render(h(AskFramesContext.Provider, { value: handle }, h(AskPanel, { tool })), container);
  });
}

function button(text: string): HTMLElement {
  // An option row's text content is its label followed by omp's description
  // (which is visible text on the row), so an option is matched by its label
  // prefix. Plain buttons ("Submit answers", "Dismiss") match exactly.
  const found = [...container.querySelectorAll('button')].find((node) => node.textContent?.startsWith(text));
  if (!found) throw new Error(`no button labelled "${text}" in ${container.innerHTML}`);
  return found as HTMLElement;
}

function click(node: HTMLElement): void {
  act(() => node.click());
}

/** The plugin control: one button that submits `answers`, one that declines. */
function makePlugin(answers: { id: string; selectedOptions: string[] }[], seen: string[]): (props: PendingInteractionProps) => unknown {
  return (props) => {
    seen.push(`id:${usePluginId() ?? 'none'};q:${props.questions.map((q) => q.id).join(',')}`);
    return h(
      'div',
      { 'data-testid': 'plugin-answer' },
      h('button', { type: 'button', 'data-testid': 'plugin-submit', onClick: () => props.submit(answers) }, 'plugin submit'),
      h('button', { type: 'button', 'data-testid': 'plugin-cancel', onClick: () => props.cancel() }, 'plugin cancel'),
    );
  };
}

describe('the plugin answer control', () => {
  test('renders nothing at all when no plugin contributed one', () => {
    act(() => {
      render(
        h(PluginPendingInteractions, { frame: GROUPED_FRAME, recorded: [false], onRespond: () => {} }),
        container,
      );
    });
    expect(container.innerHTML).toBe('');
  });

  test('an empty slot leaves the ask card byte-identical', () => {
    // The card as it renders with NO slot in its tree — the shape every
    // pre-plugin install had, and the one a plugin-less install must keep.
    act(() => {
      render(h(GroupedAsk, { frame: GROUPED_FRAME, recorded: [null], onRespond: () => {} }), container);
    });
    const withoutSlot = container.innerHTML;
    render(null, container);

    // The same card with the slot HOST mounted and no plugin registered: the
    // host is in the tree either way, so this pins that it contributes nothing.
    act(() => {
      render(
        h(GroupedAsk, {
          frame: GROUPED_FRAME,
          recorded: [null],
          onRespond: () => {},
          interactions: h(PluginPendingInteractions, {
            frame: GROUPED_FRAME,
            recorded: [false],
            onRespond: () => {},
          }),
        }),
        container,
      );
    });
    expect(container.innerHTML).toBe(withoutSlot);
  });

  test('a plugin answering the grouped card sends what the Submit button sends', () => {
    const seen: string[] = [];
    registerListSlot('demo', 'pendingInteraction', {
      id: 'auto',
      component: makePlugin([{ id: 'language', selectedOptions: ['Python'] }], seen),
    });
    mount(ASK_TOOL, [[GROUPED_FRAME]]);

    // Every render saw the same id and the same questions: the store's read is
    // re-published on mount, so the plugin renders more than once.
    expect(seen.at(-1)).toBe('id:demo;q:language');
    click(container.querySelector('[data-testid="plugin-submit"]') as HTMLElement);
    const fromPlugin = calls.at(-1);

    // The SAME answer through the human's own control, captured from the card.
    render(null, container);
    calls = [];
    mount(ASK_TOOL, [[GROUPED_FRAME]]);
    click(button('Python'));
    click(button('Submit answers'));
    const fromHuman = calls.at(-1);

    expect(fromPlugin?.response).toEqual(fromHuman?.response);
    expect(fromPlugin?.response).toEqual({ answers: [{ id: 'language', selectedOptions: ['Python'] }] });
    // Same frame, same sender: the dialog the human's click would have resolved.
    expect(fromPlugin?.request).toBe(fromHuman?.request);
  });

  test('a plugin answering a single dialog sends what the human sends', () => {
    const seen: string[] = [];
    registerListSlot('demo', 'pendingInteraction', {
      id: 'auto',
      component: makePlugin([{ id: 'ui-select', selectedOptions: ['Python'] }], seen),
    });
    mount(ASK_TOOL, [[SELECT_FRAME]]);

    expect(seen.at(-1)).toBe('id:demo;q:ui-select');
    click(container.querySelector('[data-testid="plugin-submit"]') as HTMLElement);
    const fromPlugin = calls.at(-1);

    render(null, container);
    calls = [];
    mount(ASK_TOOL, [[SELECT_FRAME]]);
    click(button('Python'));
    const fromHuman = calls.at(-1);

    expect(fromPlugin?.response).toEqual(fromHuman?.response);
    expect(fromPlugin?.response).toEqual({ value: 'Python' });
  });

  test('a plugin declining sends the Dismiss frame', () => {
    const seen: string[] = [];
    registerListSlot('demo', 'pendingInteraction', {
      id: 'auto',
      component: makePlugin([], seen),
    });
    mount(ASK_TOOL, [[GROUPED_FRAME]]);

    click(container.querySelector('[data-testid="plugin-cancel"]') as HTMLElement);
    const fromPlugin = calls.at(-1);

    render(null, container);
    calls = [];
    mount(ASK_TOOL, [[GROUPED_FRAME]]);
    click(button('Dismiss'));
    const fromHuman = calls.at(-1);

    expect(fromPlugin?.response).toEqual({ cancelled: true });
    expect(fromPlugin?.response).toEqual(fromHuman?.response);
  });

  test('a plugin that throws while rendering leaves the human able to answer', () => {
    const reported = spyOn(console, 'error').mockImplementation(() => {});
    function Broken(): never {
      throw new Error('the plugin component is broken');
    }
    registerListSlot('broken', 'pendingInteraction', { id: 'boom', component: Broken });

    mount(ASK_TOOL, [[GROUPED_FRAME]]);

    // The failure is REPORTED, on the card and on the console — never swallowed.
    const report = container.querySelector('[data-plugin-error="broken"]');
    expect(report).not.toBeNull();
    expect(report?.textContent).toContain('the plugin component is broken');
    expect(reported).toHaveBeenCalled();

    // ...and the question is still answerable, which is the whole point.
    click(button('Python'));
    click(button('Submit answers'));
    expect(calls.at(-1)?.response).toEqual({ answers: [{ id: 'language', selectedOptions: ['Python'] }] });
    reported.mockRestore();
  });

  test('a Kabmo with zero plugins still renders the card it always did', () => {
    mount(ASK_TOOL, [[GROUPED_FRAME]]);

    expect(container.querySelector('[data-testid="plugin-answer"]')).toBeNull();
    expect(container.querySelector('[data-plugin-error]')).toBeNull();
    expect(button('Submit answers')).not.toBeNull();
    expect(button('Dismiss')).not.toBeNull();
  });
});
