/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The diff panel's read is keyed on the staged flag, not only on the path.
 *
 * One file can be open as two tabs — its staged diff and its unstaged diff —
 * and the editor mounts ONE `DiffPanel` for whichever tab is active, so the
 * second tab arrives as a prop change on the same hook instance. When the
 * fetch was keyed on the path alone, that second tab kept the first tab's
 * patch on screen: the reported "staged and unstaged diffs are identical".
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useFileDiff } from '@/client/hooks/workspace/diff-file';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const originalFetch = globalThis.fetch;
let requested: string[] = [];

function Probe({ isStaged }: { isStaged: boolean }) {
  useFileDiff({ filePath: 'src/a.ts', status: 'M', isStaged, repo: '.' });
  return null;
}

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterAll(() => {
  restoreDomGlobals();
  globalThis.fetch = originalFetch;
});

beforeEach(() => {
  requested = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    const staged = new URL(url, 'http://localhost').searchParams.get('staged') === '1';
    return new Response(
      JSON.stringify({ success: true, diff: '', oldContent: '', newContent: '', status: 'M', staged }),
      { headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
});

describe('useFileDiff', () => {
  test('re-reads when the same path is opened as the other staged view', async () => {
    const container = document.createElement('div');
    await act(async () => {
      render(h(Probe, { isStaged: false }), container);
    });
    expect(requested).toHaveLength(1);
    expect(requested[0]).toContain('staged=0');

    await act(async () => {
      render(h(Probe, { isStaged: true }), container);
    });
    expect(requested).toHaveLength(2);
    expect(requested[1]).toContain('staged=1');

    await act(async () => {
      render(null, container);
    });
  });
});
