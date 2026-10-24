/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The composer's WORKSPACE picker, rendered.
 *
 * The cases a reader would otherwise find only in a browser:
 *
 *  - the trigger names the selected folder, and says what it is waiting for
 *    when nothing is selected;
 *  - the menu lists folders and NOTHING about worktrees — the split is the
 *    point of this control, and a worktree row here is the regression;
 *  - choosing another folder clears the worktree pick, because a checkout of
 *    the previous project names a path the new one cannot resolve.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { WorkspacePicker, workspaceLabel } from '@/client/components/workspace/chat-timeline/target-picker/WorkspacePicker';
import type { WorkspaceFolderData } from '@/shared/types';

const folder = (id: number, name: string): WorkspaceFolderData => ({
  id,
  name,
  project_path: `/repo/${name}`,
  isExpanded: true,
  hasMore: false,
  totalSessions: 0,
  sessions: [],
});

const mounted: HTMLElement[] = [];

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  for (const host of mounted.splice(0)) {
    render(null, host);
    host.remove();
  }
});

afterAll(() => {
  restoreDomGlobals();
});

async function mount(node: h.JSX.Element): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    render(node, host);
  });
  mounted.push(host);
  return host;
}

function textOf(host: HTMLElement): string {
  return (host.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('workspaceLabel', () => {
  test('the selected folder', () => {
    expect(workspaceLabel([folder(1, 'kabmo')], 1)).toBe('kabmo');
  });

  test('what it is waiting for, with nothing selected', () => {
    expect(workspaceLabel([], null)).toBe('Select Workspace Context');
  });
});

describe('WorkspacePicker', () => {
  test('the menu lists the workspaces and nothing about worktrees', async () => {
    const host = await mount(
      h(WorkspacePicker, {
        folders: [folder(1, 'kabmo'), folder(2, 'notes')],
        selectedFolderId: 1,
        setSelectedFolderId: () => {},
      }),
    );

    await act(async () => {
      (host.querySelector('button') as HTMLButtonElement).click();
    });

    const text = textOf(host);
    expect(text).toContain('Target Workspace');
    expect(text).toContain('kabmo');
    expect(text).toContain('notes');
    // The split: a worktree row here would be the merged menu coming back.
    expect(text).not.toContain('Quick worktree');
    expect(text).not.toContain('New worktree');
    expect(text).not.toContain('Worktrees');
  });

  test('choosing a folder clears the worktree pick', async () => {
    // A record rather than two locals: a value assigned inside a callback is
    // still narrowed to its initializer by control-flow analysis, so `picked`
    // would be `null` at the assertion.
    const seen: { picked: number | null; cleared: number } = { picked: null, cleared: 0 };
    const host = await mount(
      h(WorkspacePicker, {
        folders: [folder(1, 'kabmo'), folder(2, 'notes')],
        selectedFolderId: 1,
        setSelectedFolderId: (id) => {
          seen.picked = id;
        },
        onClearWorktree: () => {
          seen.cleared += 1;
        },
      }),
    );

    await act(async () => {
      (host.querySelector('button') as HTMLButtonElement).click();
    });
    const rows = [...host.querySelectorAll('[role="menuitemradio"]')] as HTMLButtonElement[];
    expect(rows.length).toBe(2);
    await act(async () => {
      rows[1]?.click();
    });

    expect(seen.picked).toBe(2);
    expect(seen.cleared).toBe(1);
  });
});
