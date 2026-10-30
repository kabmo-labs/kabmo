/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The four render styles, mounted through the real section.
 *
 * What is asserted is the CONTRACT every style shares, because that is what the
 * user was promised when the setting was offered:
 *
 * - the same row count and the same titles, whatever the style;
 * - a collapsed row names its tool and its subject in the expand control's
 *   `aria-label` (`chat.e2e.ts` collects `[aria-label^="Expand "]`, and
 *   `mobile.e2e.ts` clicks `/^Expand Bash/`);
 * - a failed call is visually distinct from a successful one WITHOUT opening it
 *   — the reason the card had a status badge at all;
 * - opening a row renders the same body the card would, and the body is
 *   suppressed again on close.
 *
 * The style comes from `toolRenderStyle` in the primed settings blob, so these
 * mounts exercise the real read path rather than a prop.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ToolCallingSection } from '@/client/components/workspace/chat-timeline/ToolCallingSection';
import { SessionStateProvider } from '@/client/components/common/session-state-provider';
import { primeKabmoSettings } from '@/shared/lib/settings/client';
import { applyToolRenderMode } from '@/client/hooks/chat/timeline/tool-render-mode';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { ToolCallData } from '@/shared/types/chat';

let container: HTMLElement;

beforeAll(() => installDomGlobals(new Window({ url: 'http://localhost' })));
afterAll(() => restoreDomGlobals());

beforeEach(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  restoreDomGlobals();
});

const OK_TOOL: ToolCallData = {
  id: 't1',
  type: 'bash',
  name: 'bash',
  title: 'Bash',
  status: 'success',
  command: 'bun test',
  detail: 'bun test',
  output: 'UNIQUE_OUTPUT_TOKEN_42',
  intent: 'Running the suite',
} as ToolCallData;

const FAILED_TOOL: ToolCallData = {
  id: 't2',
  type: 'bash',
  name: 'bash',
  title: 'Bash',
  status: 'error',
  command: 'bun test',
  detail: 'bun test',
  output: 'boom',
} as ToolCallData;

async function mount(tools: ToolCallData[], style: string): Promise<HTMLElement> {
  primeKabmoSettings({ kabmo_settings: { toolRenderStyle: style } });
  await act(async () => {
    render(
      h(SessionStateProvider, {
        sessionId: `test-${style}`,
        children: h(ToolCallingSection, { tools }),
      }),
      container,
    );
  });
  return container;
}

/** Every row, whichever style drew it. */
function rows(el: HTMLElement): HTMLElement[] {
  return Array.from(el.querySelectorAll('[data-tool-row]')) as HTMLElement[];
}

function toggle(el: HTMLElement): HTMLElement {
  return el.querySelector('[aria-label^="Expand "], [aria-label^="Collapse "]') as HTMLElement;
}

describe.each(['card', 'compact', 'trace', 'minimal'])('tool render style: %s', (style) => {
  test('draws one row per call and names it', async () => {
    const el = await mount([OK_TOOL], style);
    expect(el.querySelector('[data-tool-section]')?.getAttribute('data-tool-style')).toBe(style);
    expect(rows(el)).toHaveLength(1);
    expect(toggle(el).getAttribute('aria-label')).toBe('Expand Bash — bun test');
  });

  test('keeps the per-card intent heading', async () => {
    const el = await mount([OK_TOOL], style);
    expect(el.textContent).toContain('Running the suite');
  });

  test('opens the same body on click and closes it again', async () => {
    const el = await mount([OK_TOOL], style);
    expect(el.querySelector('.code-surface')).toBeNull();

    await act(async () => {
      toggle(el).click();
    });
    expect(el.querySelector('.code-surface')).not.toBeNull();
    expect(toggle(el).getAttribute('aria-label')).toBe('Collapse Bash — bun test');

    await act(async () => {
      toggle(el).click();
    });
    expect(el.querySelector('.code-surface')).toBeNull();
  });

  test('marks a failed call without opening it', async () => {
    const el = await mount([FAILED_TOOL], style);
    // The card spells it as a badge, the line styles as a glyph with a word for
    // screen readers — both say it, and neither needs the body open.
    expect(el.textContent?.toLowerCase()).toContain('fail');
  });
});

describe('a style change reaches a mounted section', () => {
  test('the section re-renders in the announced style', async () => {
    const el = await mount([OK_TOOL], 'card');
    expect(el.querySelector('[data-tool-style]')?.getAttribute('data-tool-style')).toBe('card');

    await act(async () => {
      applyToolRenderMode('trace');
    });
    expect(el.querySelector('[data-tool-style]')?.getAttribute('data-tool-style')).toBe('trace');

    await act(async () => {
      applyToolRenderMode('not-a-style');
    });
    // A value this build cannot draw falls back to the default, never to a
    // style that has no renderer.
    expect(el.querySelector('[data-tool-style]')?.getAttribute('data-tool-style')).toBe('card');
  });
});
