/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What omp's TOOL-APPROVAL gate looks like on screen.
 *
 * The gate is a `select` frame whose title is omp's whole prompt,
 * newline-separated. Two things about that shape are load-bearing and each
 * was measured against omp 18.13.1:
 *
 *  - The title is a ONE-LINE field, and the header rendered it with
 *    `truncate`, so the reason and the path were clipped out of the only
 *    element that could show them. The gate read "Allow tool: read" over a
 *    command the user never saw — and "Approve" without the thing being
 *    approved is not a decision.
 *  - omp's answer parser reads any answer that is not one of its choice
 *    labels as a DENY (measured: "Approve" allows, "yes please" denies), so
 *    the free-text "Other" field the `ask` question needs is, on a gate, a
 *    way to refuse the call by typing near-miss text.
 *
 * The frames below are omp's own, verbatim.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ExtensionDialog } from '@/client/components/workspace/chat-timeline/tool-renderers/extension-dialog';
import type { ExtensionUiDialogRequest } from '@/shared/types/omp/agent';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

/** omp's gate for a restricted-folder read. */
const RESTRICTED_READ: ExtensionUiDialogRequest = {
  type: 'extension_ui_request',
  id: 'g1',
  method: 'select',
  title: [
    'Allow tool: read',
    'Reason: Restricted folder: /tmp/livetest/secret',
    'Path: /tmp/livetest/secret/creds.txt',
  ].join('\n'),
  options: ['Approve', 'Deny'],
};

/** omp's gate for a bash call under `always-ask`. */
const BASH_GATE: ExtensionUiDialogRequest = {
  type: 'extension_ui_request',
  id: 'g2',
  method: 'select',
  title: ['Allow tool: bash', 'Command: ls -la /tmp/livetest'].join('\n'),
  options: ['Approve', 'Deny'],
};

/** An `ask` question's own dialog — the shape the free-text field serves. */
const QUESTION: ExtensionUiDialogRequest = {
  type: 'extension_ui_request',
  id: 'q1',
  method: 'select',
  title: 'Which language?',
  options: ['Python', 'Other (type your own)'],
};

let container: HTMLElement;

beforeEach(() => {
  installDomGlobals(new Window());
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  restoreDomGlobals();
});

afterAll(() => restoreDomGlobals());

/** Mount the dialog and return the text it draws. */
function draw(request: ExtensionUiDialogRequest): string {
  render(h(ExtensionDialog, { request, onRespond: () => {} }), container);
  return container.textContent ?? '';
}

describe('omp\'s tool-approval gate', () => {
  test('the reason and the path it approves are both on screen', () => {
    const text = draw(RESTRICTED_READ);

    expect(text).toContain('Restricted folder: /tmp/livetest/secret');
    expect(text).toContain('/tmp/livetest/secret/creds.txt');
    // The header names the TOOL, not the whole prompt.
    expect(text).toContain('Allow read');
  });

  test('the command it approves is on screen', () => {
    const text = draw(BASH_GATE);
    expect(text).toContain('ls -la /tmp/livetest');
    expect(text).toContain('Allow bash');
  });

  test('the free-text field is not offered on a gate', () => {
    // omp reads any non-label answer as a DENY, so a free-text field here can
    // only refuse the call.
    const text = draw(RESTRICTED_READ);
    expect(text).not.toContain('type your own answer');
    expect(container.querySelector('input[type="text"]')).toBeNull();
  });

  test('an ask question still offers its free-text field', () => {
    // The gate's rule must not take the question's field away: a question's
    // option list ends in "Other (type your own)" and needs the escape hatch.
    const text = draw(QUESTION);
    expect(text).toContain('type your own answer');
  });
});

describe('the gate\'s answer', () => {
  test('a typed answer cannot answer a gate — it is always a deny', async () => {
    const sent: unknown[] = [];
    await act(async () => {
      render(
        h(ExtensionDialog, {
          request: RESTRICTED_READ,
          onRespond: (_request, response) => sent.push(response),
        }),
        container,
      );
    });

    // omp reads any non-label answer as a deny, so the dialog must not even
    // offer a free-text field on a gate.
    expect(container.querySelector('input[type="text"]')).toBeNull();

    // The chosen option is what answers, verbatim — a label omp recognises.
    const submit = [...container.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Select Option'));
    expect(submit).toBeDefined();
    await act(async () => {
      submit!.click();
    });
    expect(sent).toEqual([{ value: 'Approve' }]);
  });
});
