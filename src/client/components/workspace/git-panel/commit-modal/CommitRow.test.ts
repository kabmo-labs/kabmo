/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Expansion is the only state that reveals a commit's detail, and the row is
 * its only toggle.
 *
 * The modal used to seed the first row as selected, so the history opened with
 * one commit already expanded — every other commit pushed down by a detail
 * nobody asked for — and a second click on that row could not close it. These
 * mounts pin the replacement contract: nothing is open until a row is clicked,
 * and clicking the open row again closes it.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { useState } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { CommitRow } from '@/client/components/workspace/git-panel/commit-modal/CommitRow';
import type { GitCommit } from '@kabmo-labs/kabmo-app-contracts/git';

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

async function mount(commitRow: GitCommit, options: { isExpanded?: boolean } = {}): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(
      h(CommitRow, {
        commit: commitRow,
        isExpanded: options.isExpanded ?? false,
        onToggleExpand: () => {},
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

/** A parent that owns the open row, the way the modal does. */
function Harness({ commitRow }: { commitRow: GitCommit }) {
  const [expanded, setExpanded] = useState(false);
  return h(CommitRow, {
    commit: commitRow,
    isExpanded: expanded,
    onToggleExpand: () => setExpanded((value) => !value),
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

describe('CommitRow expanded detail', () => {
  test('the body is hidden until the row is expanded', async () => {
    const collapsed = await mount(commit('why the change was made'));
    expect(collapsed.textContent).toContain('feat(scope): the subject line');
    expect(collapsed.textContent).not.toContain('why the change was made');

    const expanded = await mount(commit('why the change was made'), { isExpanded: true });
    expect(expanded.textContent).toContain('why the change was made');
  });

  test('clicking the row expands it', async () => {
    const el = await mountInteractive(commit('why the change was made'));
    expect(el.textContent).not.toContain('why the change was made');

    await click(el.firstElementChild!);
    expect(el.textContent).toContain('why the change was made');
  });

  test('clicking the expanded row again collapses it', async () => {
    const el = await mountInteractive(commit('why the change was made'));
    await click(el.firstElementChild!);
    expect(el.textContent).toContain('why the change was made');

    await click(el.firstElementChild!);
    expect(el.textContent).not.toContain('why the change was made');
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

  test('the file list is hidden until the row is expanded', async () => {
    const collapsed = await mount(commit(undefined, files));
    expect(collapsed.textContent).toContain('feat(scope): the subject line');
    expect(collapsed.textContent).not.toContain('src/one.ts');
    expect(collapsed.textContent).not.toContain('src/two.ts');

    const expanded = await mount(commit(undefined, files), { isExpanded: true });
    expect(expanded.textContent).toContain('src/one.ts');
    expect(expanded.textContent).toContain('src/two.ts');
  });

  test('clicking the row reveals the file list, and a second click hides it', async () => {
    const el = await mountInteractive(commit(undefined, files));
    expect(el.textContent).not.toContain('src/one.ts');

    await click(el.firstElementChild!);
    expect(el.textContent).toContain('src/one.ts');
    expect(el.textContent).toContain('src/two.ts');

    await click(el.firstElementChild!);
    expect(el.textContent).not.toContain('src/one.ts');
  });

  test('a commit with files but no body still shows the file list when expanded', async () => {
    const el = await mount(commit(undefined, files), { isExpanded: true });
    // The chevron is the affordance: without it the file list would be
    // unreachable on a one-line commit.
    const subject = Array.from(el.querySelectorAll('button[aria-expanded]')).find((button) =>
      button.textContent?.includes('feat(scope): the subject line')
    );
    expect(subject?.querySelector('svg')).toBeTruthy();
    expect(el.textContent).toContain('src/one.ts');
  });

  test('the collapsed row states how many files the commit touched', async () => {
    const el = await mount(commit(undefined, files));
    expect(el.textContent).toContain('2 files');
  });

  test('the subject is a button that reports the expanded state', async () => {
    const collapsed = await mount(commit(undefined, files));
    const collapsedSubject = Array.from(collapsed.querySelectorAll('button[aria-expanded]')).find((button) =>
      button.textContent?.includes('feat(scope): the subject line')
    ) as HTMLButtonElement | undefined;
    expect(collapsedSubject?.getAttribute('aria-expanded')).toBe('false');

    const expanded = await mount(commit(undefined, files), { isExpanded: true });
    const expandedSubject = Array.from(expanded.querySelectorAll('button[aria-expanded]')).find((button) =>
      button.textContent?.includes('feat(scope): the subject line')
    ) as HTMLButtonElement | undefined;
    expect(expandedSubject?.getAttribute('aria-expanded')).toBe('true');
  });

  test('a file row is a button that reports its own expanded state', async () => {
    const el = await mount(commit(undefined, files), { isExpanded: true });
    const fileRow = Array.from(el.querySelectorAll('button[aria-expanded]')).find((button) =>
      button.textContent?.includes('src/one.ts')
    ) as HTMLButtonElement | undefined;
    expect(fileRow).toBeTruthy();
    expect(fileRow?.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('CommitRow action strip', () => {
  test('a collapsed row renders no action buttons', async () => {
    const el = await mount(commit(undefined, []));
    expect(el.textContent).not.toContain('checkout');
  });

  test('an expanded row renders the action buttons', async () => {
    const el = await mount(commit(undefined, []), { isExpanded: true });
    expect(el.textContent).toContain('checkout');
    expect(el.textContent).toContain('cherry-pick');
  });
});
