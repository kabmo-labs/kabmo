/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The draft-target row's BRANCH control, rendered.
 *
 * Two facts a reader would otherwise only meet in a browser:
 *
 *  - the trigger's glyph is the fork, not the branch. Both controls sit in the
 *    same row and the worktree picker already draws `GitBranch`, so the two
 *    read as one control when this one copied it;
 *  - choosing a row reports that session, and "No parent" reports null — the
 *    pending chat is born top-level again.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { ParentSessionPicker } from '@/client/components/workspace/chat-timeline/target-picker/ParentSessionPicker';
import type { WorkspaceFolderData } from '@/shared/types';

const folders = [
  {
    id: 1,
    name: 'kabmo',
    sessions: [{ id: 'a', folder_id: 1, title: 'Alpha' }],
  },
] as unknown as WorkspaceFolderData[];

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

describe('ParentSessionPicker', () => {
  test('the trigger carries the fork glyph, not the worktree branch glyph', async () => {
    const host = await mount(
      h(ParentSessionPicker, { folders, sessionId: null, value: null, onChange: () => {} }),
    );

    const trigger = host.querySelector('[data-testid="parent-session-picker"]');
    expect(trigger?.querySelector('.lucide-git-fork')).not.toBeNull();
    expect(trigger?.querySelector('.lucide-git-branch')).toBeNull();
  });

  test('choosing a session reports it, and "No parent" clears the pick', async () => {
    const seen: (string | null)[] = [];
    const host = await mount(
      h(ParentSessionPicker, {
        folders,
        sessionId: 'new-1',
        value: null,
        onChange: (id) => {
          seen.push(id);
        },
      }),
    );

    await act(async () => {
      (host.querySelector('[data-testid="parent-session-picker"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      (host.querySelector('[data-testid="parent-candidate"]') as HTMLButtonElement).click();
    });
    expect(seen).toEqual(['a']);

    await act(async () => {
      (host.querySelector('[data-testid="parent-session-picker"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      (host.querySelector('[data-testid="parent-candidate-none"]') as HTMLButtonElement).click();
    });
    expect(seen).toEqual(['a', null]);
  });
});
