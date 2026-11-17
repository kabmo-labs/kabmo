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

const commit = (body?: string, files: GitCommit['files'] = []): GitCommit => ({
  hash: 'a'.repeat(40),
  shortHash: 'aaaaaaaa',
  author: 'Ada',
  date: 'Jan 01, 2024, 10:00 AM',
  message: 'feat(scope): the subject line',
  body,
  parents: [],
  files,
});

async function mount(commitRow: GitCommit, options: { isSelected?: boolean } = {}): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(
      h(CommitRow, {
        commit: commitRow,
        isSelected: options.isSelected ?? false,
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

describe('CommitRow changed-file list', () => {
  const files: GitCommit['files'] = [
    { file: 'src/one.ts', status: 'M', additions: 3, deletions: 1 },
    { file: 'src/two.ts', status: 'A', additions: 9, deletions: 0 },
  ];

  test('the file list is hidden until the row is expanded', async () => {
    const el = await mount(commit(undefined, files));
    expect(el.textContent).toContain('feat(scope): the subject line');
    expect(el.textContent).not.toContain('src/one.ts');
    expect(el.textContent).not.toContain('src/two.ts');

    await click(el.firstElementChild!);
    expect(el.textContent).toContain('src/one.ts');
    expect(el.textContent).toContain('src/two.ts');
  });

  test('a commit with files but no body still expands', async () => {
    const el = await mount(commit(undefined, files));
    // The chevron is the affordance: without it the file list would be
    // unreachable on a one-line commit.
    expect(el.querySelectorAll('svg').length).toBe(2); // copy-hash + chevron
    await click(el.firstElementChild!);
    expect(el.textContent).toContain('src/one.ts');
  });

  test('the collapsed row states how many files the commit touched', async () => {
    const el = await mount(commit(undefined, files));
    expect(el.textContent).toContain('2 files');
  });

  test('clicking again collapses the file list', async () => {
    const el = await mount(commit(undefined, files));
    await click(el.firstElementChild!);
    await click(el.firstElementChild!);
    expect(el.textContent).not.toContain('src/one.ts');
  });

  test('the subject is a button that reports and toggles the expanded state', async () => {
    const el = await mount(commit(undefined, files));
    const subject = Array.from(el.querySelectorAll('button[aria-expanded]')).find((button) =>
      button.textContent?.includes('feat(scope): the subject line')
    ) as HTMLButtonElement | undefined;
    expect(subject).toBeTruthy();
    expect(subject?.getAttribute('aria-expanded')).toBe('false');

    await click(subject!);
    expect(el.textContent).toContain('src/one.ts');
    expect(subject?.getAttribute('aria-expanded')).toBe('true');
  });

  test('a file row is a button that reports its own expanded state', async () => {
    const el = await mount(commit(undefined, files));
    await click(el.firstElementChild!);
    const fileRow = Array.from(el.querySelectorAll('button[aria-expanded]')).find((button) =>
      button.textContent?.includes('src/one.ts')
    ) as HTMLButtonElement | undefined;
    expect(fileRow).toBeTruthy();
    expect(fileRow?.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('CommitRow action strip', () => {
  test('an unselected row renders no action buttons', async () => {
    const el = await mount(commit(undefined, []));
    expect(el.textContent).not.toContain('checkout');
  });

  test('a selected row renders the action buttons', async () => {
    const el = await mount(commit(undefined, []), { isSelected: true });
    expect(el.textContent).toContain('checkout');
    expect(el.textContent).toContain('cherry-pick');
  });
});
