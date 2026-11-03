/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `tui` style — omp's terminal transcript, drawn as coloured text.
 *
 * The style is deliberately NOT a card: omp's terminal writes a call as a
 * status line (`✔ Bash: bun test [done] · 599ms`), and the colour carries what
 * a box would otherwise carry with borders. These are the properties that make
 * it that line rather than a recoloured card.
 *
 * - No frame at all — no border, no fill, no radius on the row. A regression
 *   that reintroduces a card is visible here as a class.
 * - Three separate claims, three separate colours: the outcome (`--theme-success`
 *   / `--theme-error` / `--theme-info` for a live run), the tool NAME in the
 *   accent, the SUBJECT in the meta hue. Merging the last two is the reported
 *   defect — the head then reads as one undifferentiated run of text.
 * - Facts are terminal text (`599ms · exit 0`), not pills, and a diff keeps
 *   `+4` green and `−1` red inside one statement.
 * - The head is the toggle, with the SHARED wording (`toolToggleLabel`), so
 *   `chat.e2e.ts`'s `[aria-label^="Expand "]` collection and `mobile.e2e.ts`'s
 *   `/^Expand Bash/` click still work, and the section's per-call intent
 *   heading is untouched (it is drawn outside the renderer).
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

beforeAll(() => installDomGlobals(new Window({ url: 'http://localhost' })));
afterAll(() => restoreDomGlobals());

beforeEach(() => {
  primeKabmoSettings({ kabmo_settings: { toolRenderStyle: 'tui' } });
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

const OK_TOOL: ToolCallData = {
  id: 'tui-ok',
  type: 'bash',
  name: 'bash',
  title: 'Bash',
  status: 'success',
  command: 'bun test',
  detail: 'bun test',
  output: 'TUI_OUTPUT_TOKEN',
  intent: 'Running the suite',
  details: { wallTimeMs: 599, exitCode: 0 },
} as ToolCallData;

const FAILED_TOOL: ToolCallData = {
  id: 'tui-fail',
  type: 'bash',
  name: 'bash',
  title: 'Bash',
  status: 'error',
  command: 'bun test',
  detail: 'bun test',
  output: 'boom',
  details: { exitCode: 1 },
} as ToolCallData;

const RUNNING_TOOL: ToolCallData = {
  id: 'tui-run',
  type: 'bash',
  name: 'bash',
  title: 'Bash',
  status: 'running',
  command: 'bun run build',
  detail: 'bun run dev',
  output: '',
} as ToolCallData;

const EDIT_TOOL: ToolCallData = {
  id: 'tui-edit',
  type: 'edit_file',
  name: 'edit',
  title: 'Edit',
  status: 'success',
  target: 'src/app.ts',
  detail: 'src/app.ts',
  output: 'Applied 6 changes.',
  details: { diff: 'a\n+b\n+c\n-d\n' },
} as ToolCallData;

async function mount(tools: ToolCallData[]): Promise<HTMLElement> {
  await act(async () => {
    render(
      h(SessionStateProvider, {
        sessionId: 'spec-tui',
        children: h(ToolCallingSection, { tools }),
      }),
      container,
    );
  });
  return container;
}

function row(el: HTMLElement): HTMLElement {
  const found = el.querySelector('[data-tool-row="tui"]');
  if (!found) throw new Error('no tui row');
  return found as HTMLElement;
}

function head(el: HTMLElement): HTMLElement {
  return row(el).querySelector('button') as HTMLElement;
}

/** The head's own spans, in order: glyph wrapper, title, subject, outcome… */
function headClasses(el: HTMLElement): string[] {
  return Array.from(head(el).children).map((child) => (child as HTMLElement).className);
}

describe('the tui style', () => {
  test('the section announces the style and draws a LINE, not a card', async () => {
    const el = await mount([OK_TOOL]);
    expect(el.querySelector('[data-tool-section]')?.getAttribute('data-tool-style')).toBe('tui');

    const frame = row(el);
    expect(frame.className).toContain('font-mono');
    // No card: no border, no fill, no rounded frame on the row.
    expect(frame.className).not.toContain('border');
    expect(frame.className).not.toContain('rounded');
    expect(frame.className).not.toContain('bg-');
  });

  test('the head is one status line: glyph, title, subject, bracketed outcome', async () => {
    const el = await mount([OK_TOOL]);
    const text = head(el).textContent ?? '';
    expect(text).toContain('Bash');
    expect(text).toContain(':');
    expect(text).toContain('bun test');
    // A one-line head carries the outcome as a word, not as the card's badge.
    expect(text).toContain('[done]');
    // …and the same word for a screen reader, from the shared glyph table.
    expect(head(el).querySelector('.sr-only')?.textContent).toBe('Done');
  });

  test('title and subject are different colours', async () => {
    const el = await mount([OK_TOOL]);
    const classes = headClasses(el);
    // The name is the accent, the subject the meta hue — the two halves of the
    // head must never render as one undifferentiated string.
    const title = classes.find((cls) => cls.includes('text-info'));
    const subject = classes.find((cls) => cls.includes('text-meta'));
    expect(title).toBeDefined();
    expect(subject).toBeDefined();
    expect(title).not.toBe(subject);
  });

  test('the outcome colour follows the call state', async () => {
    const ok = await mount([OK_TOOL]);
    expect(head(ok).textContent).toContain('[done]');
    expect(headClasses(ok).some((cls) => cls.includes('text-success'))).toBe(true);

    render(null, container);
    const failed = await mount([FAILED_TOOL]);
    expect(head(failed).textContent).toContain('[failed]');
    expect(headClasses(failed).some((cls) => cls.includes('text-error'))).toBe(true);

    render(null, container);
    const running = await mount([RUNNING_TOOL]);
    expect(head(running).textContent).toContain('[running]');
    expect(headClasses(running).some((cls) => cls.includes('text-info'))).toBe(true);
  });

  test('the collapsed line states the facts as terminal text', async () => {
    const el = await mount([OK_TOOL]);
    const text = row(el).textContent ?? '';
    expect(text).toContain('599ms');
    expect(text).toContain('exit 0');
    // One statement, not a row of pills.
    expect(text).toContain('·');
    // The facts are NOT behind the toggle: they are on the collapsed line.
    expect(head(el).textContent).toContain('599ms');
  });

  test('expanding shows the shared body and collapsing hides it', async () => {
    const el = await mount([OK_TOOL]);
    expect(head(el).getAttribute('aria-label')).toBe('Expand Bash — bun test');
    expect(el.querySelector('.code-surface')).toBeNull();

    await act(async () => {
      head(el).click();
    });
    expect(head(el).getAttribute('aria-expanded')).toBe('true');
    expect(head(el).getAttribute('aria-label')).toBe('Collapse Bash — bun test');
    expect(el.querySelector('.code-surface')).not.toBeNull();
    expect(row(el).textContent).toContain('TUI_OUTPUT_TOKEN');

    await act(async () => {
      head(el).click();
    });
    expect(el.querySelector('.code-surface')).toBeNull();
  });

  test('a diff keeps its two halves coloured inside one fact', async () => {
    const el = await mount([EDIT_TOOL]);
    const text = row(el).textContent ?? '';
    expect(text).toContain('+2');
    expect(text).toContain('−1');
    const marks = Array.from(row(el).querySelectorAll('.text-success, .text-error')) as HTMLElement[];
    expect(marks.some((node) => node.textContent === '+2')).toBe(true);
    expect(marks.some((node) => node.textContent === '−1')).toBe(true);
  });

  test('the per-card intent heading the section draws survives the style', async () => {
    const el = await mount([OK_TOOL]);
    expect(el.textContent).toContain('Running the suite');
  });

  test('the toggle affordance follows the open state', async () => {
    const el = await mount([OK_TOOL]);
    // `▸` closed, `▾` open — omp's own navigator glyphs.
    expect(row(el).textContent).toContain('▸');
    await act(async () => {
      head(el).click();
    });
    expect(row(el).textContent).toContain('▾');
  });
});
