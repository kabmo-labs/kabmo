/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The JSON body an unclassified tool call shows.
 *
 * The contract is deliberately narrow: when the server could not name a
 * renderer family, the card must show WHAT WAS REPORTED and nothing it
 * inferred. A guessed panel is the bug this fallback exists to remove.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { CardRow } from '@/client/components/workspace/chat-timeline/tool-renderers/styles/Card';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { ToolCallData } from '@/shared/types/chat';

let container: HTMLElement;

beforeAll(() => {
  installDomGlobals(new Window());
});

afterAll(() => restoreDomGlobals());

afterEach(() => {
  render(null, container);
  container.remove();
});

function mount(tool: ToolCallData): HTMLElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    render(h(CardRow, { tool, isOpen: true, defaultExpanded: true }), container);
  });
  return container;
}

const unknown: ToolCallData = {
  id: 'call-9',
  type: 'custom',
  title: 'VendorWidget — ls',
  name: 'VendorWidget',
  input: { path: 'a.ts' },
  output: 'some output',
  details: { vendor: 'acme' },
  render: { key: 'custom', normalized: false },
};

describe('unclassified tool body', () => {
  test('shows the raw call as JSON, never a guessed panel', () => {
    const view = mount(unknown);
    const text = view.textContent ?? '';
    expect(text).toContain('Unclassified call');
    expect(text).toContain('VendorWidget');
    expect(text).toContain('"vendor": "acme"');
    expect(text).toContain('some output');
  });

  test('a normalized call still renders its own panel', () => {
    const view = mount({
      id: 'call-1',
      type: 'bash',
      title: 'bash — ls',
      name: 'bash',
      input: { command: 'ls' },
      output: 'total 0',
      render: { key: 'bash', normalized: true },
    });
    const text = view.textContent ?? '';
    expect(text).not.toContain('Unclassified call');
    expect(text).toContain('total 0');
  });
});
