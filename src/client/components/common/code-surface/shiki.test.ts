/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The tokenizer's long-line guard, per language.
 *
 * Markdown's grammar backtracks superlinearly on a long prose line (see
 * `LINE_CHAR_LIMITS` in `shiki.ts`), which is why the guard is tighter than the
 * minified-bundle default. The rule is silent when it regresses — a viewport
 * simply costs seconds — so the guard is asserted through a mounted view: the
 * short line paints `shiki-tok` spans, the long one stays plain text.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { Window } from 'happy-dom';

import { shikiHighlight } from '@/client/components/common/code-surface/shiki';
import { bootSyntax, getHighlighterSync } from '@/shared/lib/code/highlighter';
import { ensureLanguage } from '@/shared/lib/code/highlighter-lazy';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const EXTRA_GLOBALS = ['MutationObserver', 'ResizeObserver'] as const;
const native: Partial<Record<(typeof EXTRA_GLOBALS)[number], unknown>> = {};

beforeAll(async () => {
  const win = new Window({ url: 'http://localhost' });
  installDomGlobals(win);
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of EXTRA_GLOBALS) {
    native[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  await bootSyntax();
  const highlighter = getHighlighterSync();
  if (highlighter) await ensureLanguage(highlighter, 'markdown');
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of EXTRA_GLOBALS) {
    if (native[key] === undefined) delete target[key];
    else target[key] = native[key];
  }
  restoreDomGlobals();
});

/** `- **bold** words …`, padded past the guard so the grammar would pay for it. */
function longMarkdownLine(): string {
  return `- **${'bold words '.repeat(120)}** tail`;
}

function mountMarkdown(doc: string): { view: EditorView; host: HTMLElement } {
  const host = document.body.appendChild(document.createElement('div'));
  const view = new EditorView({
    parent: host,
    state: EditorState.create({ doc, extensions: [shikiHighlight('markdown')] }),
  });
  return { view, host };
}

describe('markdown long-line guard', () => {
  test('a line past the guard renders plain while a short line still tokenizes', () => {
    const long = longMarkdownLine();
    expect(long.length).toBeGreaterThanOrEqual(1_000);

    const { view, host } = mountMarkdown(['short **bold** line', long].join('\n'));
    try {
      const lines = host.querySelectorAll<HTMLElement>('.cm-line');
      expect(lines.length).toBe(2);
      expect(lines[0].querySelectorAll('.shiki-tok').length).toBeGreaterThan(0);
      expect(lines[1].textContent).toBe(long);
      expect(lines[1].querySelectorAll('.shiki-tok').length).toBe(0);
    } finally {
      view.destroy();
      host.remove();
    }
  });
});
