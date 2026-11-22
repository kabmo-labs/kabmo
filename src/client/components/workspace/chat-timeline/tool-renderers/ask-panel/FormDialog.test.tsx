/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `method:"form"` card, mounted.
 *
 * omp 19.1.0 sends the `ask` tool's whole HTML form as ONE frame and refuses a
 * reply that does not match the form it parsed. A unit test on the payload
 * builder cannot show that the CARD sends that payload, and the reported
 * failure mode was invisible to a type check: nothing rendered at all. So this
 * mounts `AskPanel` over a live form frame and asserts what the wire receives.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useMemo } from 'preact/hooks';
import { AskPanel } from '@/client/components/workspace/chat-timeline/tool-renderers/ask-panel';
import { AskFramesContext, type AskFramesHandle } from '@/client/hooks/chat/timeline/ask-frames-context';
import { resetListSlots } from '@/client/lib/plugins/list-slots';
import type { ToolCallData } from '@/shared/types';
import type { ExtensionUiDialogRequest } from '@/shared/types/omp/agent';
import type { ExtensionDialogResponse } from '@/client/components/workspace/chat-timeline/tool-renderers/extension-dialog/Lazy';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const HTML = `<form>
  <fieldset>
    <legend>Flavour</legend>
    <label><input type="radio" name="flavour" value="yes" checked> Yes</label>
    <label><input type="radio" name="flavour" value="no"> No</label>
  </fieldset>
  <label>Serving <input type="number" name="serving" value="1" required></label>
</form>`;

const TOOL: ToolCallData = {
  id: 'call-form', type: 'other', title: 'ask', name: 'ask', status: 'running', input: { html: HTML },
};

const FRAME: ExtensionUiDialogRequest = {
  type: 'extension_ui_request', id: 'form-1', method: 'form', html: HTML,
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

function Harness({ onSent }: { onSent: (frame: ExtensionUiDialogRequest, response: ExtensionDialogResponse) => void }) {
  const handle = useMemo<AskFramesHandle>(() => ({
    framesByTool: new Map(),
    looseByTool: new Map(),
    orphanAsks: [],
    formByTool: new Map([[TOOL.id, FRAME]]),
    respond: onSent,
  }), [onSent]);
  return h(AskFramesContext.Provider, { value: handle }, h(AskPanel, { tool: TOOL }));
}

describe('the whole-form dialog', () => {
  test('draws every control at once, with one submit gated on the required field', () => {
    act(() => {
      render(h(Harness, { onSent: () => {} }), container);
    });

    expect(container.textContent).toContain('Flavour');
    expect(container.textContent).toContain('Serving');
    // A form frame is never modal material: the modal has no form body.
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    // The radio group is optional and the checked row seeds it; the required
    // number field is empty, so the submit stays disabled.
    expect(buttonStarting('Submit answers').hasAttribute('disabled')).toBe(true);
    act(() => buttonStarting('No').click());
    expect(buttonStarting('Submit answers').hasAttribute('disabled')).toBe(true);

    const serving = container.querySelector('textarea') as HTMLTextAreaElement | null;
    expect(serving).not.toBeNull();
    act(() => {
      serving!.value = '3';
      serving!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(buttonStarting('Submit answers').hasAttribute('disabled')).toBe(false);
  });

  test('one submit sends ONE { data } reply keyed by control name', () => {
    const sent: { id: string; response: ExtensionDialogResponse }[] = [];
    act(() => {
      render(h(Harness, { onSent: (frame, response) => sent.push({ id: frame.id, response }) }), container);
    });

    act(() => buttonStarting('No').click());
    const serving = container.querySelector('textarea') as HTMLTextAreaElement;
    act(() => {
      serving.value = '3';
      serving.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => buttonStarting('Submit answers').click());

    // omp compares against the form's own `value` attributes, never the labels,
    // and a number/range control submits a string it converts itself.
    expect(sent).toEqual([{ id: 'form-1', response: { data: { flavour: 'no', serving: '3' } } }]);
    // The card keeps saying what it sent while omp runs the turn.
    expect(container.textContent).toContain('Answers sent');
  });
});
