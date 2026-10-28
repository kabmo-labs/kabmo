/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `edit` card's body for the output omp actually sends: an excerpt of the
 * file, numbered rows under a `[path#TAG]` header.
 *
 * What this pins is the RENDER — that the header is the block's label rather
 * than its first line of code, that the row numbers are a gutter rather than
 * text welded onto every line, and that prose around the rows (a warning, an
 * error) is still rendered as markdown instead of being swallowed by the code
 * block. Rendered with `h()` against happy-dom, following the harness in
 * `panels/Todo.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { Edit } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/Edit';
import type { ToolCallData } from '@/shared/types';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent'] as const;
/** The runner's own globals, restored on teardown — deleting them would strip natives (Event/CustomEvent) every later file needs. */const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let container: HTMLElement;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});

async function mount(output: string) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const tool = {
    id: 'c1',
    type: 'edit',
    name: 'edit',
    title: 'edit',
    input: { path: 'src/shared/lib/chat/xml-envelope.ts' },
    output,
    status: 'success',
  } as ToolCallData;
  await act(async () => {
    render(h(Edit, { tool }), container);
  });
  return container;
}

/** The gutter ExcerptCode draws its numbers into. */
function gutters(el: HTMLElement): HTMLElement[] {
  return Array.from(el.querySelectorAll('div[aria-hidden="true"]')) as HTMLElement[];
}

const EXCERPT = [
  '[src/shared/lib/chat/xml-envelope.ts]',
  '121:function stripCommonIndent(text: string): string {',
  '122:  const lines = text.split(\'\\n\');',
  '…',
  '134:}',
].join('\n');

describe('edit output', () => {
  test('renders the header as the block label and the rows behind a gutter', async () => {
    const el = await mount(EXCERPT);

    // The path is the excerpt's label, not its first line of code.
    const labels = Array.from(el.querySelectorAll('span')).map((s) => s.textContent ?? '');
    expect(labels).toContain('src/shared/lib/chat/xml-envelope.ts');

    // The numbers live in the gutter, beside the code rather than inside it.
    const gutter = gutters(el).map((g) => g.textContent ?? '').join('|');
    expect(gutter).toContain('121');
    expect(gutter).toContain('134');

    const code = el.textContent ?? '';
    expect(code).toContain('function stripCommonIndent(text: string): string {');
    expect(code).not.toContain('121:function');
  });

  test('marks the code container as shiki, or the tokens carry no colour', async () => {
    // `highlightLines` returns spans whose colour lives in `--shiki-light` /
    // `--shiki-dark`, and only `.shiki span` consumes those variables — without
    // the class every token falls back to the inherited ink. The highlighter is
    // not loaded under happy-dom, so the class is what this can pin here; the
    // colours themselves were verified against a live server.
    const el = await mount(EXCERPT);
    const container = Array.from(el.querySelectorAll('div')).find((d) =>
      (d.className ?? '').split(/\s+/).includes('shiki'),
    );
    expect(container).toBeDefined();
    expect(container?.textContent).toContain('function stripCommonIndent');
  });

  test('shows the read-snapshot tag the header carried', async () => {
    const el = await mount(['[app/lib/omp/session/telemetry.ts#E702]', '18:export function readTelemetry() {'].join('\n'));
    expect(el.textContent ?? '').toContain('E702');
  });

  test('drops the gap marker instead of rendering it as a row', async () => {
    const el = await mount(EXCERPT);
    expect(el.textContent).not.toContain('…');
  });

  test('keeps a warning beside the rows as prose', async () => {
    const el = await mount(
      [
        '[app/lib/omp/session/telemetry.ts#E702]',
        '18:export function readTelemetry(): Telemetry {',
        '19:  return load();',
        '',
        'Warnings:',
        'Auto-repaired a replacement boundary echo at line 188.',
      ].join('\n'),
    );

    const text = el.textContent ?? '';
    expect(text).toContain('Auto-repaired a replacement boundary echo at line 188.');
    // The warning is prose, not a code row: it carries no gutter number.
    expect(gutters(el).map((g) => g.textContent ?? '').join('|')).not.toContain('Warnings');
  });

  test('renders a result with no excerpt as its own text, not as code', async () => {
    const el = await mount('Could not find a close enough match in src/foo.ts.');
    expect(el.textContent).toContain('Could not find a close enough match in src/foo.ts.');
    expect(gutters(el).length).toBe(0);
  });

  test('flags a rule reminder with its own header instead of printing the tag', async () => {
    const el = await mount(
      [
        '<system-reminder reason="rule_violation" rule="ts-no-return-type">',
        'Do not publish contracts through `ReturnType<typeof fn>`.',
        '</system-reminder>',
      ].join('\n'),
    );

    const text = el.textContent ?? '';
    expect(text).toContain('System Reminder');
    expect(text).toContain('reason=rule_violation');
    expect(text).toContain('Do not publish contracts through');
    // The wrapper is transport: its tags must not reach the reader.
    expect(text).not.toContain('</system-reminder>');
  });

  test('labels each file of a multi-file result separately', async () => {
    const el = await mount(
      [
        '[app/components/mobile/RightSidebar.tsx#AE77]',
        '6:interface MobileRightSidebarProps {',
        '',
        '[app/components/mobile/LayoutWrapper.tsx#1F85]',
        '187:      <div className="flex-1">',
      ].join('\n'),
    );

    const labels = Array.from(el.querySelectorAll('span')).map((s) => s.textContent ?? '');
    expect(labels).toContain('app/components/mobile/RightSidebar.tsx');
    expect(labels).toContain('app/components/mobile/LayoutWrapper.tsx');
    expect(gutters(el).length).toBe(2);
  });
});
