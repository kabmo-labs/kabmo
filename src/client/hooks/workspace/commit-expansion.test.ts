/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `useCommitExpansion` — the commit modal's one-open-row rule.
 *
 * Three behaviours the modal depends on, each mounted rather than inferred:
 * a page starts with NOTHING open, clicking a row opens it and clicking it
 * again closes it, and a new page (a refresh, or the modal reopened) starts
 * collapsed even though the component stayed mounted.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { h as PreactH, render as PreactRender } from 'preact';
import type { act as PreactAct } from 'preact/test-utils';
import type { useCommitExpansion as UseCommitExpansion } from '@/client/hooks/workspace/commit-expansion';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { CommitHistoryPage } from '@kabmo-labs/kabmo-app-contracts/git';

// Imported dynamically after the window exists: a static import evaluates
// Preact against the runner's windowless global and the render dies first.
let useCommitExpansion: typeof UseCommitExpansion;
let h: typeof PreactH;
let render: typeof PreactRender;
let act: typeof PreactAct;

let exposed: { expandedHash: string; toggleExpanded: (hash: string) => void } | null = null;

function page(data: string[]): CommitHistoryPage {
  return {
    success: true,
    type: 'history',
    title: 'History',
    data: data.map((hash) => ({ hash, shortHash: hash.slice(0, 8), message: hash, author: 'a', date: 'now' })),
  } as CommitHistoryPage;
}

async function mountPage(output: CommitHistoryPage | null): Promise<{
  rerender: (next: CommitHistoryPage | null) => Promise<void>;
  toggle: (hash: string) => Promise<void>;
  expanded: () => string;
}> {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const Probe = ({ output: current }: { output: CommitHistoryPage | null }) => {
    exposed = useCommitExpansion(current);
    return null;
  };

  const rerender = async (next: CommitHistoryPage | null) => {
    await act(async () => {
      render(h(Probe, { output: next }), container);
    });
  };
  await rerender(output);

  return {
    rerender,
    toggle: async (hash: string) => {
      await act(async () => { exposed?.toggleExpanded(hash); });
    },
    expanded: () => exposed?.expandedHash ?? '(unmounted)',
  };
}

beforeAll(async () => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  ({ useCommitExpansion } = await import('@/client/hooks/workspace/commit-expansion'));
  ({ h, render } = await import('preact'));
  ({ act } = await import('preact/test-utils'));
});

afterAll(() => {
  restoreDomGlobals();
});

describe('useCommitExpansion', () => {
  test('a page opens with no row expanded', async () => {
    const { expanded } = await mountPage(page(['aaa', 'bbb']));
    expect(expanded()).toBe('');
  });

  test('a click opens the row and a second click closes it', async () => {
    const { toggle, expanded } = await mountPage(page(['aaa', 'bbb']));

    await toggle('aaa');
    expect(expanded()).toBe('aaa');

    await toggle('aaa');
    expect(expanded()).toBe('');
  });

  test('opening another row closes the previous one', async () => {
    const { toggle, expanded } = await mountPage(page(['aaa', 'bbb']));

    await toggle('aaa');
    await toggle('bbb');
    expect(expanded()).toBe('bbb');

    // The previous row's state is gone, not merely overridden: clicking it
    // opens it rather than "closing" a row that is already closed.
    await toggle('aaa');
    expect(expanded()).toBe('aaa');
  });

  test('a new page starts collapsed', async () => {
    const { rerender, toggle, expanded } = await mountPage(page(['aaa', 'bbb']));
    await toggle('aaa');
    expect(expanded()).toBe('aaa');

    await rerender(page(['ccc', 'ddd']));
    expect(expanded()).toBe('');

    // And it is the NEW page's state that answers: opening a row still works.
    await toggle('ccc');
    expect(expanded()).toBe('ccc');
  });

  test('a null page is collapsed, and the next open page too', async () => {
    const { rerender, toggle, expanded } = await mountPage(page(['aaa']));
    await toggle('aaa');
    expect(expanded()).toBe('aaa');

    // The modal returns null while closed, then renders the next open with a
    // FRESH output object — the row left open is not carried over.
    await rerender(null);
    expect(expanded()).toBe('');
    await rerender(page(['bbb']));
    expect(expanded()).toBe('');
  });
});
