/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What every render style must show, whichever frame it draws.
 *
 * A style is a frame, not a capability: the card, the status line, the rail
 * node and the terminal line all render the same call. Three facts used to be
 * card-only, and each one was a silent loss in the other four styles:
 *
 *  - a tool with no specialized panel (a custom or plugin tool) had no body at
 *    all, because the line styles gated the body on a panel while the card
 *    always rendered the generic Input / Diff / Output;
 *  - a result omp capped or rewrote had no "Full output" chip, so the truncated
 *    copy on screen was the only copy the reader could reach;
 *  - a reminder envelope in the result read as an ordinary success.
 *
 * The trace node's `warn` tone is pinned here too: an aborted call used to fall
 * through to the muted node, indistinguishable from a running or skipped one.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ToolCallingSection } from '@/client/components/workspace/chat-timeline/ToolCallingSection';
import { SessionStateProvider } from '@/client/components/common/session-state-provider';
import { primeKabmoSettings } from '@/shared/lib/settings/client';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { ToolCallData } from '@/shared/types/chat';

let container: HTMLElement;

beforeAll(() => installDomGlobals(new Window({ url: 'http://localhost/?sessionId=parity' })));
afterAll(() => restoreDomGlobals());

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

/** A tool the host has no panel for — the generic body is its only body. */
const CUSTOM_TOOL: ToolCallData = {
  id: 'custom-1',
  type: 'custom',
  name: 'web_fetch',
  title: 'Web Fetch',
  status: 'success',
  input: { url: 'https://example.com' },
  output: 'CUSTOM_OUTPUT_TOKEN',
} as ToolCallData;

/** A result omp capped, with the lossless original behind an artifact id. */
const ARTIFACT_TOOL: ToolCallData = {
  id: 'artifact-1',
  type: 'bash',
  name: 'bash',
  title: 'Bash',
  status: 'success',
  command: 'seq 1 100000',
  output: 'truncated',
  details: { meta: { limits: { columnTruncated: { artifactId: '42', artifactElidedBytes: 1024 } } } },
} as ToolCallData;

/** The runtime interrupting the call, not its outcome. */
const REMINDER_TOOL: ToolCallData = {
  id: 'reminder-1',
  type: 'bash',
  name: 'bash',
  title: 'Bash',
  status: 'success',
  command: 'bun test',
  output: '<system-reminder>Every turn MUST end with a tool call.</system-reminder>',
} as ToolCallData;

const ABORTED_TOOL: ToolCallData = {
  id: 'aborted-1',
  type: 'bash',
  name: 'bash',
  title: 'Bash',
  status: 'aborted',
  command: 'bun test',
  output: '',
} as ToolCallData;

async function mount(tools: ToolCallData[], style: string): Promise<HTMLElement> {
  primeKabmoSettings({ kabmo_settings: { toolRenderStyle: style } });
  await act(async () => {
    render(
      h(SessionStateProvider, {
        sessionId: `parity-${style}`,
        children: h(ToolCallingSection, { tools }),
      }),
      container,
    );
  });
  return container;
}

describe.each(['card', 'compact', 'trace', 'minimal', 'tui'])('style parity: %s', (style) => {
  test('a panel-less tool opens its generic body', async () => {
    const el = await mount([CUSTOM_TOOL], style);
    const toggle = el.querySelector('[data-tool-row] button') as HTMLElement;
    expect(toggle.getAttribute('aria-label')).toBe('Expand WEB Fetch');

    await act(async () => {
      toggle.click();
    });
    expect(el.querySelector('.code-surface')?.textContent).toContain('CUSTOM_OUTPUT_TOKEN');
  });

  test('a spilled result offers the full output', async () => {
    const el = await mount([ARTIFACT_TOOL], style);
    expect(el.querySelector('[aria-label="Read the full output"]')).not.toBeNull();
  });

  test('a reminder envelope is flagged', async () => {
    const el = await mount([REMINDER_TOOL], style);
    expect(el.textContent).toContain('Reminder');
  });
});

describe('the trace node tone', () => {
  test('an aborted call takes the warning tone, not the muted one', async () => {
    const el = await mount([ABORTED_TOOL], 'trace');
    const node = el.querySelector('[data-tool-row="trace"] > span[aria-hidden="true"]') as HTMLElement;
    expect(node.className).toContain('bg-warning');
  });
});
