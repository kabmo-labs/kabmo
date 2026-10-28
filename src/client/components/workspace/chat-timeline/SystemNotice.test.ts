/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The goal-mode notice card, which exists because the generic one was wrong for
 * this content.
 *
 * A goal turn is `display:false` and carries no tool call, so its only route
 * into the timeline is a `notice` row — and the generic card shows a notice's
 * first line as its subtitle. On a continuation that line is
 * `<!-- Hidden continuation steer … -->`, and the body is the whole internal
 * prompt: the raw HTML comment ended up as the title of a card in the user's
 * conversation. These pin the three kinds against that, and pin the generic
 * card for everything else.
 *
 * Rendered with `h()` (no JSX) against happy-dom, the same way
 * `ModeToggles.test.ts` and `GoalBanner.test.ts` do.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { SystemNotice } from '@/client/components/workspace/chat-timeline/SystemNotice';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event'] as const;
/** The runner's own globals, restored on teardown — deleting them would strip natives (Event/CustomEvent) every later file needs. */const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

const CONTINUATION = [
  '<!-- Hidden continuation steer. role=user, suppressed from visible transcript. -->',
  '',
  'Continue active goal.',
  '',
  '<objective>',
  'Keep the log in sync: append one line per turn.',
  '</objective>',
  '',
  'Budget:',
  '- Tokens used: 1431',
  '- Token budget: none',
  '- Tokens remaining: unbounded',
  '- Time used: 14 seconds',
  '',
  'Autonomous continuation; NEVER redefine success.',
].join('\n');

let container: HTMLElement;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  container = document.body.appendChild(document.createElement('div'));
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});

async function paint(props: { notice: string; source?: string }): Promise<HTMLElement> {
  if (container) render(null, container);
  await act(async () => {
    render(h(SystemNotice, props), container);
  });
  return container;
}

describe('SystemNotice', () => {
  test('a goal continuation renders OPEN: labelled, no toggle, body already there', async () => {
    const el = await paint({ notice: CONTINUATION, source: 'goal-continuation' });

    expect(el.textContent).toContain('Goal continuation');
    expect(el.textContent).not.toContain('System Notice');
    // The raw comment is what the generic card would have shown as the title.
    expect(el.textContent).not.toContain('Hidden continuation steer');

    // Nothing to click: no expander attribute, and the header is inert.
    expect(el.querySelector('button[aria-expanded]')).toBeNull();
    expect((el.querySelector('button') as HTMLButtonElement).disabled).toBe(true);

    // The body is on screen without a click — objective, figures, instructions.
    expect(el.textContent).toContain('Objective');
    expect(el.textContent).toContain('Keep the log in sync: append one line per turn.');
    expect(el.textContent).toContain('tokens 1.4k');
    expect(el.textContent).toContain('budget none');
    expect(el.textContent).toContain('left unbounded');
    expect(el.textContent).toContain('Instructions sent with it');
    expect(el.textContent).toContain('Autonomous continuation');
    // The internal message's own wrapping is gone from the rendered card.
    expect(el.textContent).not.toContain('<objective>');
  });

  test("omp's context block and a goal's opening turn get their own labels, also open", async () => {
    const context = await paint({ notice: '<goal_context>\n<objective>Ship it.</objective>\n`goal` tool: get.', source: 'goal-mode-context' });
    expect(context.textContent).toContain('Goal context');
    expect(context.textContent).toContain('Ship it.');
    expect(context.querySelector('button[aria-expanded]')).toBeNull();

    const start = await paint({ notice: 'Migrate the importer to streaming.', source: 'goal-start' });
    expect(start.textContent).toContain('Goal started');
    // A single-line objective still gets the body, so the card is never blank.
    expect(start.textContent).toContain('Objective');
    expect(start.textContent).toContain('Migrate the importer to streaming.');
    expect(start.querySelector('button[aria-expanded]')).toBeNull();
  });

  test('any other notice keeps the generic collapsed card', async () => {
    const el = await paint({ notice: 'Reloaded omp engine' });
    expect(el.textContent).toContain('System Notice');
    expect(el.textContent).toContain('Reloaded omp engine');
    // Still a real toggle for everything else.
    expect(el.querySelector('button[aria-expanded]')).toBeNull(); // single line → nothing to expand
    const multi = await paint({ notice: 'Line one\nLine two' });
    expect(multi.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe('false');
    expect(multi.textContent).not.toContain('Line two');
  });
});

/**
 * omp's loop guard writes its notice inside `<system-interrupt>`, a wrapper the
 * card had no case for: the tag is not a `<system-reminder>`, so the generic
 * branch ran and the card's title was the raw markup line
 * `<system-interrupt reason="thinking_loop_detected">`.
 */
describe('SystemNotice system-interrupt', () => {
  const INTERRUPT = [
    '<system-interrupt reason="thinking_loop_detected">',
    'Loop guard interrupted prior turn: near-identical reasoning repeated without progress.',
    '',
    'Break pattern now:',
    '- STOP narrating intended actions. Issue one concrete tool call.',
    '</system-interrupt>',
  ].join('\n');

  test('names the guard, shows its reason, and strips the tag from the body', async () => {
    const el = await paint({ notice: INTERRUPT, source: 'thinking-loop-redirect' });

    expect(el.textContent).toContain('System Interrupt');
    expect(el.textContent).toContain('thinking_loop_detected');
    // The raw tag is scaffolding — it must not appear anywhere in the card.
    expect(el.textContent).not.toContain('<system-interrupt');
    expect(el.textContent).not.toContain('System Notice');
    // The body underneath is the instruction, so the card is expandable.
    expect(el.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe('false');
  });

  test('a body quoting markup still renders whole', async () => {
    const withSample = [
      '<system-interrupt reason="tool_call_loop_detected">',
      'You called `yield` with `{"data":{"job":"bg_1"}}`.',
      '',
      '```typescript',
      'const x: Promise<LoadedConfig> = load();',
      '```',
      '</system-interrupt>',
    ].join('\n');
    const el = await paint({ notice: withSample });

    expect(el.textContent).toContain('System Interrupt');
    expect(el.textContent).not.toContain('<system-interrupt');
    await act(async () => {
      (el.querySelector('button') as HTMLButtonElement).click();
    });
    expect(el.textContent).toContain('Promise<LoadedConfig>');
  });
});
