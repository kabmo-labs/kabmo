/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The harness a pending chat will spawn on, and the pick that records it.
 *
 * This is the reported defect pinned from the hook side: the composer's tab
 * strip moved to `opencode`, the pick was written nowhere the send path reads,
 * and the server spawned `omp-rpc`. Two halves must hold:
 *
 *  - a PICK is written to the ref the spawn reads (`pendingHarnessRef`) AND is
 *    rendered, because the picker has to show what the user just chose;
 *  - a pick belongs to ONE chat. A different pending chat is a different choice,
 *    and a spawned chat with a sidebar row is not editable at all.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { useSessionHarness, type SessionHarness } from '@/client/hooks/chat/timeline/session-harness';
import { recordSpawnHarness, resetSpawnHarness } from '@/client/hooks/chat/timeline/spawn-harness';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { WorkspaceFolderData } from '@/shared/types';

let container: HTMLElement;
let mounted: { value: SessionHarness | null } = { value: null };

beforeAll(() => installDomGlobals(new Window({ url: 'http://localhost' })));
afterAll(() => restoreDomGlobals());

beforeEach(() => {
  resetSpawnHarness();
  mounted = { value: null };
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

/** One folder holding a spawned chat recorded on `claude`. */
const FOLDERS = [
  { id: 1, name: 'ws', sessions: [{ id: 'sess-1', folder_id: 1, title: 'A', harness: 'claude' }] },
] as unknown as WorkspaceFolderData[];

/** Render the hook for one chat and return its latest value. */
function probe(options: {
  sessionId: string | null;
  messageCount?: number;
  pendingHarnessRef: { current: string | null };
  folderList?: WorkspaceFolderData[];
}): SessionHarness {
  function Inner() {
    mounted.value = useSessionHarness(
      options.folderList ?? [],
      options.sessionId,
      options.messageCount ?? 0,
      options.pendingHarnessRef,
    );
    return null;
  }
  act(() => {
    render(h(Inner, {}), container);
  });
  return mounted.value as SessionHarness;
}

describe('pending harness pick', () => {
  test('a pick writes the ref the spawn reads and renders itself', () => {
    const pendingHarnessRef = { current: null as string | null };
    const first = probe({ sessionId: 'new-1', pendingHarnessRef });
    expect(first.harness).toBeUndefined();
    expect(first.editable).toBe(true);

    act(() => first.pick('opencode'));
    const picked = mounted.value as SessionHarness;
    // The send path reads the REF — a pick that only moved the strip is exactly
    // the bug that spawned omp for an opencode click.
    expect(pendingHarnessRef.current).toBe('opencode');
    expect(picked.harness).toBe('opencode');
  });

  test('a pick does not follow the user to another pending chat', () => {
    const pendingHarnessRef = { current: null as string | null };
    const first = probe({ sessionId: 'new-1', pendingHarnessRef });
    act(() => first.pick('opencode'));

    const other = probe({ sessionId: 'new-2', pendingHarnessRef: { current: null } });
    expect(other.harness).toBeUndefined();
  });

  test("a spawned chat reports the sidebar row's harness", () => {
    const value = probe({
      sessionId: 'sess-1',
      folderList: FOLDERS,
      pendingHarnessRef: { current: null },
    });
    expect(value.harness).toBe('claude');
  });

  test('a transcript makes the harness read-only', () => {
    const pendingHarnessRef = { current: null as string | null };
    const value = probe({ sessionId: 'new-1', messageCount: 2, pendingHarnessRef });
    expect(value.editable).toBe(false);
    // Still nameable: the run that exists is the one the footer must report.
    act(() => value.pick('codex'));
    expect((mounted.value as SessionHarness).harness).toBe('codex');
  });

  test("a spawn's answer names the agent before the sidebar row exists", () => {
    recordSpawnHarness('uuid-1', 'opencode');
    const value = probe({ sessionId: 'uuid-1', pendingHarnessRef: { current: null } });
    expect(value.harness).toBe('opencode');
  });

  test('the row wins over the spawn record once it arrives', () => {
    recordSpawnHarness('sess-1', 'opencode');
    const value = probe({
      sessionId: 'sess-1',
      folderList: FOLDERS,
      pendingHarnessRef: { current: null },
    });
    expect(value.harness).toBe('claude');
  });
});
