import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useMemo, useState } from 'preact/hooks';
import { AskPanel } from '@/client/components/workspace/chat-timeline/tool-renderers/ask-panel';
import { AskFramesContext, type AskFramesHandle } from '@/client/hooks/chat/timeline/ask-frames';
import { resetListSlots } from '@/client/lib/plugins/list-slots';
import type { ToolCallData } from '@/shared/types';
import type { ExtensionUiDialogRequest } from '@/shared/types/omp/agent';
import type { ExtensionDialogResponse } from '@/client/components/workspace/chat-timeline/tool-renderers/extension-dialog/Lazy';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const QUESTIONS = [
  { id: 'q1', question: 'Pick a language', options: [{ label: 'Python' }, { label: 'Go' }] },
  { id: 'q2', question: 'Pick a size', options: [{ label: 'S' }, { label: 'M' }] },
];
const TOOL: ToolCallData = {
  id: 'call-ask', type: 'other', title: 'ask', name: 'ask', status: 'running', input: { questions: QUESTIONS },
};

const FIRST: ExtensionUiDialogRequest = {
  type: 'extension_ui_request', id: 'f1', method: 'select', title: 'Pick a language',
  options: ['Python (Recommended)', 'Go', 'Other (type your own)'],
};
const SECOND: ExtensionUiDialogRequest = {
  type: 'extension_ui_request', id: 'f2', method: 'select', title: 'Pick a size',
  options: ['S', 'M'],
};

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

function buttonStarting(prefix: string): HTMLElement {
  const found = [...container.querySelectorAll('button')].find((node) => node.textContent?.trim().startsWith(prefix));
  if (!found) throw new Error(`no button starting with "${prefix}" in ${container.innerHTML}`);
  return found as HTMLElement;
}

/** AskPanel over a live per-field queue; each answer raises the next frame. */
function Harness({
  first,
  next,
  onSent,
}: {
  first: ExtensionUiDialogRequest;
  next: ExtensionUiDialogRequest | null;
  onSent: (frame: ExtensionUiDialogRequest, response: ExtensionDialogResponse) => void;
}) {
  const [groups, setGroups] = useState<ExtensionUiDialogRequest[][]>([[first], []]);
  const handle = useMemo<AskFramesHandle>(() => ({
    framesByTool: new Map([[TOOL.id, groups]]),
    looseByTool: new Map(),
    orphanAsks: [],
    respond: (frame, response) => {
      onSent(frame, response);
      setGroups(next ? [[], [next]] : [[], []]);
    },
  }), [groups, next, onSent]);
  return h(AskFramesContext.Provider, { value: handle }, h(AskPanel, { tool: TOOL }));
}

describe('the grouped form for a per-field ask', () => {
  test('draws every question at once with ONE submit, disabled until all are answered', () => {
    act(() => {
      render(h(Harness, { first: FIRST, next: SECOND, onSent: () => {} }), container);
    });

    expect(container.textContent).toContain('Pick a language');
    expect(container.textContent).toContain('Pick a size');
    const submit = buttonStarting('Submit answers');
    expect(submit.hasAttribute('disabled')).toBe(true);

    act(() => buttonStarting('Python').click());
    expect(buttonStarting('Submit answers').hasAttribute('disabled')).toBe(true);
    act(() => buttonStarting('M').click());
    expect(buttonStarting('Submit answers').hasAttribute('disabled')).toBe(false);
  });

  test('one submit walks the fields: omp still receives one response per frame', () => {
    const sent: { id: string; response: ExtensionDialogResponse }[] = [];
    act(() => {
      render(h(Harness, {
        first: FIRST,
        next: SECOND,
        onSent: (frame, response) => sent.push({ id: frame.id, response }),
      }), container);
    });

    act(() => buttonStarting('Python').click());
    act(() => buttonStarting('M').click());
    act(() => buttonStarting('Submit answers').click());

    expect(sent).toEqual([
      { id: 'f1', response: { value: 'Python (Recommended)' } },
      { id: 'f2', response: { value: 'M' } },
    ]);
    // Both answers are drawn as sent while omp consumes them.
    expect(container.textContent).toContain('Sending your answers');
  });

  test('a default-checked multi row is kept, not toggled off', () => {
    // The form marks the row `checked`, so omp already has it ON. Sending its
    // label would toggle it OFF; the submit must only send the DONE row.
    const checkedTool: ToolCallData = {
      ...TOOL,
      details: { answers: [{ name: 'q2', question: 'Pick a size', answer: 'S' }] },
      input: {
        questions: [
          {
            id: 'm1',
            question: 'Normalise the text?',
            multi: true,
            options: [{ label: 'Fix typos', checked: true }],
          },
          { id: 'q2', question: 'Pick a size', options: [{ label: 'S' }, { label: 'M' }] },
        ],
      },
    };
    const frame: ExtensionUiDialogRequest = {
      type: 'extension_ui_request',
      id: 'checked-1',
      method: 'select',
      title: 'Normalise the text?',
      options: ['Fix typos', '✓ Done selecting'],
      selectionMarker: 'checkbox',
      checkedIndices: [0],
    };
    const sent: ExtensionDialogResponse[] = [];
    function CheckedHarness() {
      const [groups, setGroups] = useState<ExtensionUiDialogRequest[][]>([[frame], []]);
      const handle = useMemo<AskFramesHandle>(() => ({
        framesByTool: new Map([[checkedTool.id, groups]]),
        looseByTool: new Map(),
        orphanAsks: [],
        respond: (_request, response) => {
          sent.push(response);
          setGroups([[], []]);
        },
      }), [groups]);
      return h(AskFramesContext.Provider, { value: handle }, h(AskPanel, { tool: checkedTool }));
    }

    act(() => { render(h(CheckedHarness, {}), container); });
    expect(container.textContent).toContain('answered');
    act(() => buttonStarting('Submit answers').click());

    expect(sent).toEqual([{ value: '✓ Done selecting' }]);
  });

  test('a multi-select sends each label then the DONE row', () => {
    const multiTool: ToolCallData = {
      ...TOOL,
      details: { answers: [{ name: 'q2', question: 'Pick a size', answer: 'S' }] },
      input: {
        questions: [
          { id: 'm1', question: 'Pick colours', multi: true, options: [{ label: 'Red' }, { label: 'Blue' }] },
          { id: 'q2', question: 'Pick a size', options: [{ label: 'S' }, { label: 'M' }] },
        ],
      },
    };
    const frames: ExtensionUiDialogRequest[] = [0, 1, 2].map((index) => ({
      type: 'extension_ui_request',
      id: `m${index}`,
      method: 'select',
      title: 'Pick colours',
      options: ['Red', 'Blue', 'Other (type your own)', '✓ Done selecting'],
      selectionMarker: 'checkbox',
    }));
    const sent: ExtensionDialogResponse[] = [];
    let step = 0;
    function MultiHarness() {
      const [groups, setGroups] = useState<ExtensionUiDialogRequest[][]>([[frames[0]],]);
      const handle = useMemo<AskFramesHandle>(() => ({
        framesByTool: new Map([[multiTool.id, groups]]),
        looseByTool: new Map(),
        orphanAsks: [],
        respond: (_frame, response) => {
          sent.push(response);
          step += 1;
          setGroups(step < frames.length ? [[frames[step]]] : [[]]);
        },
      }), [groups]);
      return h(AskFramesContext.Provider, { value: handle }, h(AskPanel, { tool: multiTool }));
    }

    act(() => { render(h(MultiHarness, {}), container); });
    act(() => buttonStarting('Red').click());
    act(() => buttonStarting('Blue').click());
    act(() => buttonStarting('Submit answers').click());

    expect(sent).toEqual([
      { value: 'Red' },
      { value: 'Blue' },
      { value: '✓ Done selecting' },
    ]);
  });
});
