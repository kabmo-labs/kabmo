/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Clicking a commit row opens its full message.
 *
 * The row drew `%s` alone, so a commit whose body carried the reasoning — the
 * common shape in this repository — showed one line and gave no way to read
 * the rest. What these mounts pin is the pair that makes the affordance
 * honest: a commit WITH a body expands on click (the subject stays, the body
 * appears below it), and a one-line commit offers nothing to expand, because a
 * chevron that opens an empty block reads as a broken row.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { CommitRow } from '@/client/components/workspace/git-panel/commit-modal/CommitRow';
import type { GitCommit } from '@/shared/types/git';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'getSelection'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

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

const commit = (body?: string): GitCommit => ({
  hash: 'a'.repeat(40),
  shortHash: 'aaaaaaaa',
  author: 'Ada',
  date: 'Jan 01, 2024, 10:00 AM',
  message: 'feat(scope): the subject line',
  body,
  parents: [],
  files: [],
});

async function mount(commitRow: GitCommit): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(
      h(CommitRow, {
        commit: commitRow,
        isSelected: false,
        isGraphMode: false,
        onSelect: () => {},
        onAction: () => {},
        onToggleFile: () => {},
        isExpandedFile: () => false,
        isLoadingFile: () => false,
        isFullContextFile: () => false,
        onToggleContext: () => {},
        fileDiffs: {},
      }),
      container
    );
  });
  return container;
}

async function click(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }) as unknown as Event);
  });
}

describe('CommitRow message expansion', () => {
  test('the body is hidden until the row is clicked', async () => {
    const el = await mount(commit('why the change was made'));
    expect(el.textContent).toContain('feat(scope): the subject line');
    expect(el.textContent).not.toContain('why the change was made');

    await click(el.firstElementChild!);
    expect(el.textContent).toContain('why the change was made');
  });

  test('clicking again collapses the body', async () => {
    const el = await mount(commit('why the change was made'));
    await click(el.firstElementChild!);
    await click(el.firstElementChild!);
    expect(el.textContent).not.toContain('why the change was made');
  });

  test('a one-line commit renders no body and no expand affordance', async () => {
    const el = await mount(commit(undefined));
    expect(el.textContent).toContain('feat(scope): the subject line');
    // The subject row carries no chevron, so the row never promises a body.
    expect(el.querySelectorAll('svg').length).toBe(1); // the copy-hash icon only
  });

  test('a click that ends a text selection does not collapse the body', async () => {
    const el = await mount(commit('selectable text'));
    await click(el.firstElementChild!);
    expect(el.textContent).toContain('selectable text');

    // Simulate selecting part of the body, then clicking to copy it.
    const range = document.createRange();
    range.selectNodeContents(el.querySelector('div.whitespace-pre-wrap')!);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    await click(el.firstElementChild!);
    expect(el.textContent).toContain('selectable text');

    selection.removeAllRanges();
    await click(el.firstElementChild!);
    expect(el.textContent).not.toContain('selectable text');
  });
});
