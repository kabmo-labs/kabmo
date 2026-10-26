/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The split editor's session-backed state, mounted through the REAL provider.
 *
 * The rules are unit-tested in `shared/lib/workspace/split-editor.test.ts`; what only a
 * mount can see is that this hook applies them and PERSISTS the result:
 *
 * - `enabled: false` (a split pane) reports no right pane even when the blob says one,
 *   which is what stops the column becoming a tree.
 * - A persisted id for a tab that is gone reports an unsplit column instead of a pane that
 *   cannot render.
 * - Activating the tab the right pane already shows collapses the split, rather than
 *   drawing one file twice.
 * - A dragged divider position is CLAMPED before it is written, so neither pane can be
 *   squeezed out of existence.
 *
 * Rendered with `h()` against happy-dom, over a stubbed `fetch` that answers the session
 * blob — the provider loads it before anything is ready.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { SessionStateProvider } from '@/client/components/common/session-state-provider/index';
import { useSplitEditor, type SplitEditorHandle } from '@/client/hooks/editor/use-split-editor';
import { forgetSession } from '@/shared/lib/workspace/session-state/store';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { OpenedFile } from '@/shared/types/fs';

const SESSION = 'new-split-editor';
/** The runner's own fetch, reached through `Bun` so a leaked stub cannot be mistaken for it. */
const nativeFetch = Bun.fetch;

function file(id: string): OpenedFile {
  return { id, name: `${id}.ts`, path: `src/${id}.ts` };
}

const A = file('a');
const B = file('b');

let container: HTMLElement;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
  forgetSession(SESSION);
  (globalThis as unknown as Record<string, unknown>).fetch = nativeFetch;
});

afterAll(() => {
  restoreDomGlobals();
});

interface MountOptions {
  stored?: Record<string, unknown>;
  openedFiles?: OpenedFile[];
  activeFileId?: string | number | null;
  enabled?: boolean;
}

/** Mount the hook and return a live reader for its result. */
async function mount(options: MountOptions = {}): Promise<() => SplitEditorHandle> {
  const target = globalThis as unknown as Record<string, unknown>;
  const stored = options.stored ?? {};
  target.fetch = async () =>
    new Response(JSON.stringify({ sessionId: SESSION, state: stored }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  const openedFiles = options.openedFiles ?? [A, B];
  const activeFileId = options.activeFileId === undefined ? 'a' : options.activeFileId;
  const enabled = options.enabled ?? true;

  let slot: SplitEditorHandle | null = null;

  function Probe() {
    slot = useSplitEditor({ openedFiles, activeFileId, enabled });
    return null;
  }

  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(SessionStateProvider, { sessionId: SESSION, children: h(Probe, null) }), container);
  });
  // The provider's blob load settles across a tick.
  for (let i = 0; i < 10; i += 1) await act(async () => {});

  return () => {
    if (!slot) throw new Error('the hook never rendered');
    return slot;
  };
}

describe('useSplitEditor', () => {
  test('an unsplit column reports no right pane', async () => {
    const read = await mount();
    expect(read().rightFile).toBeNull();
  });

  test('splitting to another open tab reports it, and closing the pane keeps the tab', async () => {
    const read = await mount();
    await act(async () => read().splitTo('b'));

    expect(read().rightFile?.id).toBe('b');

    // Closing the pane is a VIEW decision: the tab list is untouched, which is why the
    // callback takes no id.
    await act(async () => read().close());
    expect(read().rightFile).toBeNull();
  });

  test('splitting to the left pane’s own tab is refused', async () => {
    const read = await mount();
    await act(async () => read().splitTo('a'));
    expect(read().rightFile).toBeNull();
  });

  test('a persisted id for a tab that is gone opens an unsplit column', async () => {
    const read = await mount({ stored: { 'editor.split': { rightFileId: 'gone', fraction: 0.5 } } });
    expect(read().rightFile).toBeNull();
  });

  test('activating the tab the right pane shows collapses the split', async () => {
    // The same file on both sides is a wide pane with a divider through it, so the split
    // gives way — the user asked to look at THAT file.
    const read = await mount({
      stored: { 'editor.split': { rightFileId: 'b', fraction: 0.5 } },
      activeFileId: 'b',
    });
    expect(read().rightFile).toBeNull();
  });

  test('a stored split on another tab is restored', async () => {
    const read = await mount({ stored: { 'editor.split': { rightFileId: 'b', fraction: 0.35 } } });
    expect(read().rightFile?.id).toBe('b');
    expect(read().fraction).toBe(0.35);
  });

  test('a split pane (enabled: false) never reports a right pane, so the column is not a tree', async () => {
    const read = await mount({
      stored: { 'editor.split': { rightFileId: 'b', fraction: 0.5 } },
      enabled: false,
    });
    expect(read().rightFile).toBeNull();
  });

  test('a dragged divider is clamped, so neither pane can be squeezed out', async () => {
    const read = await mount();
    await act(async () => read().setFraction(0.99));
    expect(read().fraction).toBeLessThanOrEqual(0.8);

    await act(async () => read().setFraction(0.01));
    expect(read().fraction).toBeGreaterThanOrEqual(0.2);
  });
});
