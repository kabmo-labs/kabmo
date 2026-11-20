/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Files panel row's two git marks.
 *
 * The name and the dot are TWO marks for ONE fact, so they must wear the same
 * tone. They diverged once: the row re-derived the dot from the `has*` flags
 * with its own priority (deleted first) while the tone came from
 * `buildGitStatusMaps`, so a folder holding an added + modified + deleted file
 * named itself blue and drew a red dot. The assertions here are on the rendered
 * classes, because that is the only thing the reader sees.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { TreeRowLabel } from '@/client/components/workspace/file-explorer/RowLabel';
import { buildGitStatusMaps } from '@/shared/lib/fs/git-status';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { GitChange } from '@/shared/types/git';

let container: HTMLElement;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterAll(() => {
  restoreDomGlobals();
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

function change(file: string, status: string, staged = false): GitChange {
  return { file, status, staged } as GitChange;
}

/** Render the row for `src` and hand back its name span and dot span. */
function mountFolderRow(changes: GitChange[]): { name: Element; dot: Element } {
  const folderStatus = buildGitStatusMaps(changes).folderMap.get('src');
  if (!folderStatus) throw new Error('test fixture registers no src folder');

  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    render(
      h(TreeRowLabel, {
        name: 'src',
        path: 'src',
        isFolder: true,
        isOpen: true,
        ignored: false,
        gitStatus: null,
        folderStatus,
      }),
      container,
    );
  });

  const name = container.querySelector('span.truncate');
  const dot = container.querySelector('span.rounded-full');
  if (!name || !dot) throw new Error('row drew no name or no dot');
  return { name, dot };
}

describe('TreeRowLabel folder marks', () => {
  test('add + modified + delete paints the dot blue like the name', () => {
    const { name, dot } = mountFolderRow([
      change('src/a.ts', 'A '),
      change('src/b.ts', ' M'),
      change('src/c.ts', ' D'),
    ]);
    expect(name.classList.contains('text-info')).toBe(true);
    expect(dot.classList.contains('bg-info')).toBe(true);
    expect(dot.classList.contains('bg-error')).toBe(false);
  });

  test('a deleted-only folder is red in both marks', () => {
    const { name, dot } = mountFolderRow([change('src/a.ts', ' D')]);
    expect(name.classList.contains('text-error')).toBe(true);
    expect(dot.classList.contains('bg-error')).toBe(true);
  });
});
