/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The editor's drop target.
 *
 * Three claims, and each is a way the gesture can go wrong invisibly:
 *
 * - A drop that RESOLVES opens the file through the same `omp:open-file` event
 *   every other surface uses, so the editor has one entry point — including a
 *   file from OUTSIDE every workspace, which the drop itself grants.
 * - A drop that is REFUSED (a binary, an oversized file, a directory) reports
 *   the server's own sentence instead of opening a tab that would only render
 *   it.
 * - The gesture is CLAIMED (`stopPropagation`) so the composer's window-level
 *   drop handler cannot also see it — otherwise one drop both opens the file
 *   and queues it as a chat attachment.
 *
 * The DOM, the `fetch` stub and the `DataTransfer` shapes live in
 * `use-editor-drop.test-util.ts`: this file is the CASES.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useEditorDrop, type UseEditorDropResult } from '@/client/hooks/editor/use-editor-drop';
import { writeThroughHandle } from '@/client/lib/launch/file-handlers';
import {
  bytesTransfer,
  fakeHandle,
  fileTransfer,
  finderTransfer,
  installDropHarness,
  mountEditorDrop,
  openedFiles,
  queueScopeResponses,
  resetDropHarness,
  restoreDropHarness,
  scopeFetchCalls,
  setScopeResponse,
} from '@/client/hooks/editor/use-editor-drop.test-util';

beforeAll(installDropHarness);
afterAll(restoreDropHarness);

describe('useEditorDrop', () => {
  beforeEach(resetDropHarness);

  test('a resolved reference opens the file through omp:open-file', async () => {
    setScopeResponse({
      ok: true,
      status: 200,
      body: { root: '/repo', path: 'src/app.ts', name: 'app.ts', kind: 'text' },
    });
    const harness = await mountEditorDrop();
    await harness.drop(fileTransfer('file:///repo/src/app.ts'));

    expect(scopeFetchCalls()[0]).toContain('/api/fs/scope?path=');
    expect(openedFiles()).toHaveLength(1);
    expect(openedFiles()[0]).toEqual({ path: 'src/app.ts', name: 'app.ts', root: '/repo' });
  });

  test('a file outside every workspace is granted by the drop, then opened', async () => {
    // The reported case: a report dragged off the Desktop. The scope route
    // refuses it by name, the drop registers the file's own directory, and the
    // SAME reference then resolves — which is what makes a drop from anywhere
    // open a tab instead of a sentence saying it cannot.
    queueScopeResponses([
      { ok: false, status: 403, body: { error: 'That file is outside every workspace this console can read.', code: 'outside_workspace' } },
      { ok: true, status: 200, body: { root: '/Users/x/Desktop', path: 'report.pdf', name: 'report.pdf', kind: 'document' } },
    ]);
    const harness = await mountEditorDrop();
    await harness.drop(fileTransfer('file:///Users/x/Desktop/report.pdf'));

    expect(scopeFetchCalls()[0]).toContain('/api/fs/scope?path=');
    expect(scopeFetchCalls()[1]).toContain('/api/fs/grant');
    expect(openedFiles()).toHaveLength(1);
    expect(openedFiles()[0]).toEqual({ path: 'report.pdf', name: 'report.pdf', root: '/Users/x/Desktop' });
    expect(harness.results.at(-1)?.ok).toBe(true);
  });

  test('a binary file is refused with the server sentence, and opens nothing', async () => {
    setScopeResponse({
      ok: true,
      status: 200,
      body: { root: '/repo', path: 'blob.bin', name: 'blob.bin', kind: 'binary', error: 'This file is not text, so it cannot be shown in the editor.' },
    });
    const harness = await mountEditorDrop();
    await harness.drop(fileTransfer('file:///repo/blob.bin'));

    expect(openedFiles()).toHaveLength(0);
    expect(harness.results.at(-1)?.ok).toBe(false);
    expect(harness.results.at(-1)?.message).toContain('not text');
  });

  test('a path outside every workspace reports the refusal by name', async () => {
    // A refusal with NO `outside_workspace` code: final, so no grant is tried.
    setScopeResponse({ ok: false, status: 403, body: { error: 'That file is outside every workspace this console can read.' } });
    const harness = await mountEditorDrop();
    await harness.drop(fileTransfer('file:///etc/hosts'));

    expect(openedFiles()).toHaveLength(0);
    expect(harness.results.at(-1)?.message).toContain('outside every workspace');
  });

  test('a Finder drag with a handle opens the file and can be saved', async () => {
    const { handle, writes } = fakeHandle('from-finder.ts', 'const a = 1;\n');
    const harness = await mountEditorDrop();
    await harness.drop(finderTransfer(handle));

    // No server round trip: a Finder drag carries no path at all.
    expect(scopeFetchCalls()).toHaveLength(0);
    expect(openedFiles()).toHaveLength(1);
    const detail = openedFiles()[0] as { path: string; content?: string; handleId?: string };
    expect(detail.path).toBe('from-finder.ts');
    expect(detail.content).toBe('const a = 1;\n');
    expect(detail.handleId).toBeTruthy();
    expect(harness.results.at(-1)?.ok).toBe(true);

    // And the handle is live, so a save writes through it rather than failing.
    expect(await writeThroughHandle(detail.handleId!, 'edited\n', { interactive: false })).toBe('written');
    expect(writes).toEqual(['edited\n']);
  });

  test('bytes with no path are reported, not silently dropped', async () => {
    const harness = await mountEditorDrop();
    await harness.drop(bytesTransfer());

    // No scope request is made — there is no path to resolve.
    expect(scopeFetchCalls()).toHaveLength(0);
    expect(harness.results.at(-1)?.message).toContain('composer');
  });

  test('a disabled target makes no request and opens nothing', async () => {
    const harness = await mountEditorDrop(false);
    await harness.drop(fileTransfer('file:///repo/src/app.ts'));

    expect(scopeFetchCalls()).toHaveLength(0);
    expect(openedFiles()).toHaveLength(0);
    expect(harness.results).toHaveLength(0);
  });
});

/**
 * The capture-phase claim, which exists because CodeMirror handles `drop`
 * itself: for a drag carrying files it reads each file's TEXT and inserts it
 * into the document, then calls `preventDefault`, so the panel's own handler saw
 * `defaultPrevented` and stood down. Measured in the browser: dropping `b.ts` on
 * an open `a.ts` put `b.ts`'s text at the top of the buffer, and the autosave
 * wrote it to disk.
 *
 * The claim is scoped to a code surface, so a drop on the composer is still the
 * composer's.
 */
describe('useEditorDrop capture claim', () => {
  /** A drop event whose target is `element`, recording the calls it received. */
  function captureEvent(target: Node, transfer: DataTransfer) {
    const calls: string[] = [];
    const event = {
      target,
      dataTransfer: transfer,
      preventDefault: () => calls.push('preventDefault'),
      stopPropagation: () => calls.push('stopPropagation'),
    };
    return { event: event as never, calls };
  }

  async function capture(api: UseEditorDropResult | null, event: unknown): Promise<void> {
    await act(async () => {
      api?.captureDropProps.onDropCapture(event as never);
    });
    for (let pass = 0; pass < 4; pass += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  /** Mount the hook and hand back the API plus a node for each target shape. */
  async function mountWithTargets() {
    const results: { ok: boolean; message: string }[] = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const surface = document.createElement('div');
    surface.setAttribute('data-code-surface', '');
    const inner = document.createElement('div');
    surface.appendChild(inner);
    const composer = document.createElement('div');
    container.append(surface, composer);

    let api: UseEditorDropResult | null = null;
    const Probe = () => {
      api = useEditorDrop({ enabled: true, onResult: (r) => results.push(r) });
      return null;
    };
    await act(async () => {
      render(h(Probe, {}), container);
    });
    return { api: () => api, inner, composer, results };
  }

  beforeEach(resetDropHarness);

  test('claims a file drop aimed at a code surface, and opens the file', async () => {
    setScopeResponse({
      ok: true,
      status: 200,
      body: { root: '/repo', path: 'src/b.ts', name: 'b.ts', kind: 'text' },
    });
    const { api, inner } = await mountWithTargets();
    const { event, calls } = captureEvent(inner, fileTransfer('file:///repo/src/b.ts'));

    await capture(api(), event);

    // Claimed BEFORE the surface's own handler could insert the file's text.
    expect(calls).toEqual(['preventDefault', 'stopPropagation']);
    expect(openedFiles()).toHaveLength(1);
  });

  test('leaves a drop aimed anywhere else to the bubble handler', async () => {
    const { api, composer } = await mountWithTargets();
    const { event, calls } = captureEvent(composer, fileTransfer('file:///repo/src/b.ts'));

    await capture(api(), event);

    expect(calls).toEqual([]);
    expect(openedFiles()).toHaveLength(0);
  });

  test('ignores a text drag, which CodeMirror should still insert', async () => {
    const { api, inner } = await mountWithTargets();
    const textDrag = { types: ['text/plain'], files: [], getData: () => 'copied text' } as unknown as DataTransfer;
    const { event, calls } = captureEvent(inner, textDrag);

    await capture(api(), event);

    expect(calls).toEqual([]);
  });
});
