/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Selection is the only state that reveals a commit's detail.
 *
 * The row used to fire two events on one click: select the commit and toggle
 * its expansion. The file list could then be open on a row that was not the
 * selected one. These mounts pin the replacement contract: the body and the
 * changed-file list render for the selected commit, and clicking a row only
 * selects it.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { useState } from 'preact/hooks';
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

/** A parent that owns the selection, the way the modal does. */
function Harness({ commitRow }: { commitRow: GitCommit }) {
  const [selected, setSelected] = useState(false);
  return h(CommitRow, {
    commit: commitRow,
    isSelected: selected,
    onSelect: () => setSelected(true),
    onAction: () => {},
    onToggleFile: () => {},
    isExpandedFile: () => false,
    isLoadingFile: () => false,
    isFullContextFile: () => false,
    onToggleContext: () => {},
    fileDiffs: {},
  });
}

async function mountInteractive(commitRow: GitCommit): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(Harness, { commitRow }), container);
  });
  return container;
}

async function click(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }) as unknown as Event);
  });
}

describe('CommitRow selected detail', () => {
  test('the body is hidden until the commit is selected', async () => {
    const unselected = await mount(commit('why the change was made'));
    expect(unselected.textContent).toContain('feat(scope): the subject line');
    expect(unselected.textContent).not.toContain('why the change was made');

    const selected = await mount(commit('why the change was made'), { isSelected: true });
    expect(selected.textContent).toContain('why the change was made');
  });

  test('clicking the row selects the commit and reveals its detail', async () => {
    const el = await mountInteractive(commit('why the change was made'));
    expect(el.textContent).not.toContain('why the change was made');

    await click(el.firstElementChild!);
    expect(el.textContent).toContain('why the change was made');
  });

  test('clicking the selected row again keeps the detail visible', async () => {
    const el = await mountInteractive(commit('why the change was made'));
    await click(el.firstElementChild!);
    await click(el.firstElementChild!);
    expect(el.textContent).toContain('why the change was made');
  });

  test('a one-line commit with no files renders no detail affordance', async () => {
    const el = await mount(commit(undefined));
    expect(el.textContent).toContain('feat(scope): the subject line');
    // The subject row carries no chevron, so the row never promises a detail.
    expect(el.querySelectorAll('svg').length).toBe(1); // the copy-hash icon only
  });
});

describe('CommitRow changed-file list', () => {
  const files: GitCommit['files'] = [
    { file: 'src/one.ts', status: 'M', additions: 3, deletions: 1 },
    { file: 'src/two.ts', status: 'A', additions: 9, deletions: 0 },
  ];

  test('the file list is hidden until the commit is selected', async () => {
    const unselected = await mount(commit(undefined, files));
    expect(unselected.textContent).toContain('feat(scope): the subject line');
    expect(unselected.textContent).not.toContain('src/one.ts');
    expect(unselected.textContent).not.toContain('src/two.ts');

    const selected = await mount(commit(undefined, files), { isSelected: true });
    expect(selected.textContent).toContain('src/one.ts');
    expect(selected.textContent).toContain('src/two.ts');
  });

  test('clicking the row selects the commit and reveals the file list', async () => {
    const el = await mountInteractive(commit(undefined, files));
    expect(el.textContent).not.toContain('src/one.ts');

    await click(el.firstElementChild!);
    expect(el.textContent).toContain('src/one.ts');
    expect(el.textContent).toContain('src/two.ts');
  });

  test('a commit with files but no body still shows the file list when selected', async () => {
    const el = await mount(commit(undefined, files), { isSelected: true });
    // The chevron is the affordance: without it the file list would be
    // unreachable on a one-line commit.
    const subject = Array.from(el.querySelectorAll('button[aria-expanded]')).find((button) =>
      button.textContent?.includes('feat(scope): the subject line')
    );
    expect(subject?.querySelector('svg')).toBeTruthy();
    expect(el.textContent).toContain('src/one.ts');
  });

  test('the unselected row states how many files the commit touched', async () => {
    const el = await mount(commit(undefined, files));
    expect(el.textContent).toContain('2 files');
  });

  test('the subject is a button that reports the selected state', async () => {
    const unselected = await mount(commit(undefined, files));
    const unselectedSubject = Array.from(unselected.querySelectorAll('button[aria-expanded]')).find((button) =>
      button.textContent?.includes('feat(scope): the subject line')
    ) as HTMLButtonElement | undefined;
    expect(unselectedSubject?.getAttribute('aria-expanded')).toBe('false');

    const selected = await mount(commit(undefined, files), { isSelected: true });
    const selectedSubject = Array.from(selected.querySelectorAll('button[aria-expanded]')).find((button) =>
      button.textContent?.includes('feat(scope): the subject line')
    ) as HTMLButtonElement | undefined;
    expect(selectedSubject?.getAttribute('aria-expanded')).toBe('true');
  });

  test('a file row is a button that reports its own expanded state', async () => {
    const el = await mount(commit(undefined, files), { isSelected: true });
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
