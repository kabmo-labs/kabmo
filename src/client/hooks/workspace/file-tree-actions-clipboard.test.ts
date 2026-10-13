/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `useFileActions`'s clipboard rows: what a row's Cut, Copy, Duplicate and
 * Paste ask for, and which targets are offered a Paste at all.
 *
 * The row owns none of the behaviour — it names a TARGET and hands it to the
 * panel's clipboard (`useFileClipboard`), which posts the request. Splitting
 * that is what keeps a row's menu and the panel background's menu from drifting
 * on what a paste does, and it is what these cases assert: the target the row
 * names, the absence of any request the row could have posted itself, and the
 * Paste label the menu reads.
 *
 * A folder is `path === name` in this harness, which is what the row uses to
 * tell the two apart.
 */

import { describe, expect, test } from 'bun:test';
import { createFileActionsHarness, useFileActionsHarness } from '@/test-support/file-actions.test-util';

const harness = createFileActionsHarness();
useFileActionsHarness(harness);

describe('useFileActions clipboard', () => {
  test('Cut and Copy fill the clipboard; the row is the entry, not a request', async () => {
    const srv = harness.server({});
    harness.stubFetch(srv);
    await harness.mount({ path: 'src/a.ts', name: 'a.ts' });

    await harness.step(() => harness.actions()?.handleAction('cut'));
    expect(harness.clipboard()?.calls).toEqual([
      { action: 'cut', target: { path: 'src/a.ts', name: 'a.ts', kind: 'file' } },
    ]);

    await harness.step(() => harness.actions()?.handleAction('copy'));
    expect(harness.clipboard()?.calls.map((call) => call.action)).toEqual(['cut', 'copy']);
    // Neither touches the server: the clipboard is client state.
    expect(srv.requests).toEqual([]);
  });

  test('Duplicate is delegated to the panel, which owns the request', async () => {
    const srv = harness.server({});
    harness.stubFetch(srv);
    await harness.mount({ path: 'src/a.ts', name: 'a.ts' });

    await harness.step(() => harness.actions()?.handleAction('duplicate'));
    await harness.settle();

    // The panel's hook posts it (and refreshes): the row only names the target,
    // so the two entry points — a row's menu and the background's — cannot
    // drift on what a duplicate does.
    expect(harness.clipboard()?.calls).toEqual([
      { action: 'duplicate', target: { path: 'src/a.ts', name: 'a.ts', kind: 'file' } },
    ]);
    expect(srv.requests).toEqual([]);
  });

  test('Paste hands the clipboard’s entry to the panel, which owns the request', async () => {
    const srv = harness.server({});
    harness.stubFetch(srv);
    await harness.mount({ path: 'dest', name: 'dest' });

    await harness.step(() => harness.actions()?.handleAction('paste'));

    // The row delegates: the panel's hook is what knows the clipboard's source
    // path, and sending the row's own path would move a file onto itself.
    expect(harness.clipboard()?.calls).toEqual([
      { action: 'paste', target: { path: 'dest', name: 'dest', kind: 'folder' } },
    ]);
    expect(srv.requests).toEqual([]);
  });

  test('the Paste row exists only where the clipboard’s entry can land', async () => {
    harness.stubFetch(harness.server({}));
    await harness.mount({ path: 'dest', name: 'dest' });
    // Nothing copied: no label, so the menu draws no Paste row.
    expect(harness.actions()?.pasteLabel).toBeNull();

    await harness.step(() => harness.actions()?.handleAction('copy'));
    expect(harness.actions()?.pasteLabel).toBeNull();

    const clip = { scope: '/root\u0000.', path: 'a.ts', name: 'a.ts', kind: 'file' as const, mode: 'copy' as const };
    await harness.mount({ path: 'dest', name: 'dest' }, { clipboard: { clip } });
    expect(harness.actions()?.pasteLabel).toBe('Paste a.ts');

    await harness.mount(
      { path: 'dest', name: 'dest' },
      { clipboard: { clip, refusal: 'Cannot paste a folder into itself' } },
    );
    expect(harness.actions()?.pasteLabel).toBeNull();
  });

  test('the Paste row names a folder target with the folder kind', async () => {
    harness.stubFetch(harness.server({}));
    await harness.mount({ path: 'src', name: 'src' });

    await harness.step(() => harness.actions()?.handleAction('cut'));

    expect(harness.clipboard()?.calls).toEqual([
      { action: 'cut', target: { path: 'src', name: 'src', kind: 'folder' } },
    ]);
  });
});
