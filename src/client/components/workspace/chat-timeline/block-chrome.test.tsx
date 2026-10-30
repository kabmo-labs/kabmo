/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Every transcript block wears the frame of the chosen style — not just the
 * tool rows.
 *
 * The defect this pins: `toolRenderStyle` reached `ToolCallingSection` only, so
 * a user on `compact` got compact tool rows sandwiched between a thinking card
 * and a notice card in the old frame. A setting that half applies is a setting
 * that reads as broken, and the fix is structural — one `blockChrome` table
 * consulted by every block.
 *
 * Mounted against happy-dom and read from RENDERED markup, because the classes
 * were right in the table while a component still spelled its own frame out.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ThinkingSection } from '@/client/components/workspace/chat-timeline/ThinkingSection';
import { SystemNotice } from '@/client/components/workspace/chat-timeline/SystemNotice';
import { primeKabmoSettings } from '@/shared/lib/settings/client';
import { applyToolRenderMode } from '@/client/hooks/chat/timeline/tool-render-mode';
import { blockChrome } from '@/shared/lib/chat/timeline/block-chrome';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;

beforeAll(() => installDomGlobals(new Window({ url: 'http://localhost' })));
afterAll(() => restoreDomGlobals());

beforeEach(() => {
  // The DOM globals are installed ONCE for the file (beforeAll): swapping
  // them per test churns `window`/`Event` for every other suite sharing the
  // process, which made a later file register its hooks after the run had
  // completed (`Cannot call beforeEach() after the test run has completed`).
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

/** A thought long enough that the block renders (an empty one renders nothing). */
const THOUGHT = { thought: 'Read the summary module, then patch the header row.', duration: '1.2s' };
/** A multi-line notice: single-line notices have nothing to expand. */
const NOTICE = 'Line one\nLine two';
const MULTI_LINE_NOTICE = NOTICE;

async function paint(style: string, node: preact.ComponentChildren): Promise<HTMLElement> {
  // Unmount first: preact reuses the instance for a same-type vnode, so a
  // mounted hook keeps the mode it read on its FIRST render and a second
  // paint would assert against the previous style.
  render(null, container);
  primeKabmoSettings({ kabmo_settings: { toolRenderStyle: style } });
  await act(async () => {
    render(node as never, container);
  });
  return container;
}

describe('blockChrome', () => {
  test('only the card style has a frame', () => {
    expect(blockChrome('card').frame).toContain('rounded-xl');
    expect(blockChrome('card').frame).toContain('border-ink/10');
    for (const mode of ['compact', 'trace', 'minimal'] as const) {
      expect(blockChrome(mode).frame).toBe('');
    }
  });

  test('only the trace style places a node, and it is the only one with a relative root', () => {
    expect(blockChrome('trace').node).toBeDefined();
    expect(blockChrome('trace').root).toContain('relative');
    expect(blockChrome('compact').node).toBeUndefined();
    expect(blockChrome('card').node).toBeUndefined();
    expect(blockChrome('minimal').node).toBeUndefined();
  });

  test('the minimal style is the smallest type, the frame styles the largest', () => {
    expect(blockChrome('minimal').title).toContain('text-[11.5px]');
    expect(blockChrome('card').title).toContain('text-[12px]');
    expect(blockChrome('card').header).toContain('px-3 py-2.5');
    expect(blockChrome('compact').header).toContain('py-1');
  });
});

describe('thinking follows the render style', () => {
  test('the card frame is present on card, absent on every line style', async () => {
    const card = await paint('card', h(ThinkingSection, { thinking: THOUGHT }));
    expect(card.innerHTML).toContain('rounded-xl');

    for (const style of ['compact', 'trace', 'minimal']) {
      const el = await paint(style, h(ThinkingSection, { thinking: THOUGHT }));
      expect(el.innerHTML).not.toContain('rounded-xl');
    }
  });

  test('trace places a NODE on the turn rail; the other styles place none', async () => {
    const trace = await paint('trace', h(ThinkingSection, { thinking: THOUGHT }));
    const marks = Array.from(trace.querySelectorAll('[aria-hidden="true"]')) as HTMLElement[];
    // The block contributes its node only — the LINE is the turn's (TurnRail),
    // because a per-block segment broke wherever prose sat between blocks.
    expect(marks.some((el) => el.className.includes('rounded-full'))).toBe(true);
    expect(marks.some((el) => el.className.includes('w-px'))).toBe(false);

    const compact = await paint('compact', h(ThinkingSection, { thinking: THOUGHT }));
    const compactMarks = Array.from(compact.querySelectorAll('[aria-hidden="true"]')) as HTMLElement[];
    expect(compactMarks.some((el) => el.className.includes('rounded-full'))).toBe(false);
  });

  test('a style change reaches a mounted thinking block', async () => {
    await paint('card', h(ThinkingSection, { thinking: THOUGHT }));
    expect(container.innerHTML).toContain('rounded-xl');

    await act(async () => applyToolRenderMode('minimal'));
    expect(container.innerHTML).not.toContain('rounded-xl');
  });
});

describe('system notice follows the render style', () => {
  test('the card frame is present on card, absent on every line style', async () => {
    const card = await paint('card', h(SystemNotice, { notice: MULTI_LINE_NOTICE }));
    expect(card.innerHTML).toContain('rounded-xl');

    for (const style of ['compact', 'trace', 'minimal']) {
      const el = await paint(style, h(SystemNotice, { notice: MULTI_LINE_NOTICE }));
      expect(el.innerHTML).not.toContain('rounded-xl');
    }
  });

  test('the notice body uses the style body container, so it hangs off the same rail', async () => {
    const el = await paint('compact', h(SystemNotice, { notice: MULTI_LINE_NOTICE }));
    const toggle = el.querySelector('button[aria-expanded]') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await act(async () => {
      toggle.click();
    });
    expect(el.querySelector('.border-l.border-dashed')).not.toBeNull();
    expect(el.textContent).toContain('Line two');
  });

  test('a goal notice still renders OPEN with no toggle, in every style', async () => {
    for (const style of ['card', 'compact', 'trace', 'minimal']) {
      const el = await paint(style, h(SystemNotice, {
        notice: '<objective>Ship it.</objective>\n`goal` tool: get.',
        source: 'goal-mode-context',
      }));
      expect(el.textContent).toContain('Goal context');
      expect(el.querySelector('button[aria-expanded]')).toBeNull();
    }
  });
});
