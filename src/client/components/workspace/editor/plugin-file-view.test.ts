/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor's viewer slots, resolved.
 *
 * The resolution is a PRIORITY, so the cases that matter are the ones where two
 * plugins disagree: an opener that refuses must fall through to a renderer, and
 * an opener that accepts must beat one. The zero-row case is pinned first
 * because it is the invariant the hosts depend on — a Kabmo with no plugins
 * resolves nothing and therefore draws its built-in viewer, unchanged.
 *
 * Every assertion is made against RENDERED TEXT rather than a captured value:
 * a probe left mounted re-renders when the store publishes, and a captured
 * variable would then be answering from the previous case's tree. Rendering
 * with `h()` (no JSX) against happy-dom, and unmounting each root before the
 * next one, keeps each case reading its own tree.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { DiffRendererProps, FileOpenerProps, SourceCodeRendererProps } from '@kabmo-labs/kabmo-sdk';
import { registerListSlot, resetListSlots } from '@/client/lib/plugins/list-slots';
import { setPluginContext } from '@/client/lib/plugins/context';
import {
  PluginFileViewBody,
  usePluginDiffView,
  usePluginFileView,
  type PluginFileViewFile,
} from '@/client/components/workspace/editor/plugin-file-view';

/** The shape a registration's `matches` is handed. */
type MatchedFile = { path: string; extension: string };

const Opener = ({ path, extension, sessionId, workspacePath }: FileOpenerProps) =>
  h('span', null, `opened ${path} ${extension} ${sessionId ?? '-'} ${workspacePath ?? '-'}`);
const SourceView = ({ content }: SourceCodeRendererProps) => h('span', null, `source ${content}`);
const DiffView = ({ diff }: DiffRendererProps) => h('span', null, `diff ${diff}`);

beforeEach(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  resetListSlots();
  setPluginContext(null, null);
});

afterEach(() => {
  resetListSlots();
});

afterAll(() => restoreDomGlobals());

/** Draw a non-diff file through the resolver exactly as the editor does. */
function FileProbe({ file }: { file: PluginFileViewFile }) {
  const view = usePluginFileView(file);
  return h('span', null, view ? h(PluginFileViewBody, { view }) : 'none');
}

/** Draw a diff tab through the resolver exactly as the diff panel does. */
function DiffProbe({ path, diff }: { path: string; diff: string }) {
  const view = usePluginDiffView({ path, diff });
  return h('span', null, view ? h(view.Component, view.props) : 'none');
}

/**
 * Mount into a fresh root, read its text, then UNMOUNT — the store's listeners
 * are live, and a root left behind re-renders on the next registration.
 */
function drawText(vnode: Parameters<typeof render>[0]): string {
  const element = document.body.appendChild(document.createElement('div'));
  act(() => {
    render(vnode, element);
  });
  const text = element.textContent ?? '';
  act(() => {
    render(null, element);
  });
  element.remove();
  return text;
}

describe('usePluginFileView', () => {
  test('resolves nothing when no plugin contributed a viewer', () => {
    expect(drawText(h(FileProbe, { file: { path: 'src/a.ts', content: 'x' } }))).toBe('none');
  });

  test('uses the first opener whose matches accepts the file', () => {
    registerListSlot('demo', 'fileOpener', { id: 'first', matches: () => false, component: Opener });
    registerListSlot('demo', 'fileOpener', {
      id: 'second',
      matches: (file: MatchedFile) => file.path.endsWith('.md'),
      component: Opener,
    });

    expect(drawText(h(FileProbe, { file: { path: 'docs/readme.md', content: '# hi' } })))
      .toBe('opened docs/readme.md .md - -');
  });

  test('falls through to a source renderer claiming the extension', () => {
    registerListSlot('demo', 'fileOpener', { id: 'no', matches: () => false, component: Opener });
    registerListSlot('demo', 'sourceCodeRenderer', { id: 'md', extensions: ['.md'], component: SourceView });

    expect(drawText(h(FileProbe, { file: { path: 'docs/readme.md', content: '# hi' } }))).toBe('source # hi');
  });

  test('lets a matching opener win over a source renderer', () => {
    registerListSlot('demo', 'fileOpener', { id: 'all', matches: () => true, component: Opener });
    registerListSlot('demo', 'sourceCodeRenderer', { id: 'md', extensions: ['.md'], component: SourceView });

    expect(drawText(h(FileProbe, { file: { path: 'docs/readme.md', content: '# hi' } })))
      .toBe('opened docs/readme.md .md - -');
  });

  test('lowercases the extension before matching', () => {
    const seen: string[] = [];
    registerListSlot('demo', 'fileOpener', {
      id: 'probe',
      matches: (file: MatchedFile) => {
        seen.push(file.extension);
        return false;
      },
      component: Opener,
    });
    registerListSlot('demo', 'sourceCodeRenderer', { id: 'md', extensions: ['.md'], component: SourceView });

    expect(drawText(h(FileProbe, { file: { path: 'docs/README.MD', content: 'x' } }))).toBe('source x');
    // The mount effect re-reads the store, so `matches` runs again; every
    // observation must still be the lowercased extension.
    expect([...new Set(seen)]).toEqual(['.md']);
  });

  test('claims no extension for a dotfile', () => {
    const seen: string[] = [];
    registerListSlot('demo', 'fileOpener', {
      id: 'probe',
      matches: (file: MatchedFile) => {
        seen.push(file.extension);
        return false;
      },
      component: Opener,
    });

    expect(drawText(h(FileProbe, { file: { path: '.gitignore', content: '' } }))).toBe('none');
    expect([...new Set(seen)]).toEqual(['']);
  });

  test('hands the published session and workspace to the view', () => {
    setPluginContext('session-1', '/ws');
    registerListSlot('demo', 'fileOpener', { id: 'all', matches: () => true, component: Opener });

    expect(drawText(h(FileProbe, { file: { path: 'a.ts', content: 'x' } })))
      .toBe('opened a.ts .ts session-1 /ws');
  });
});

describe('usePluginDiffView', () => {
  test('resolves nothing when no renderer claims the file', () => {
    expect(drawText(h(DiffProbe, { path: 'src/a.ts', diff: 'x' }))).toBe('none');
  });

  test('applies a renderer that names no extensions to every diff', () => {
    registerListSlot('demo', 'diffRenderer', { id: 'any', component: DiffView });

    expect(drawText(h(DiffProbe, { path: 'src/a.ts', diff: '@@ -1 +1 @@' }))).toBe('diff @@ -1 +1 @@');
  });

  test('matches only the extensions it lists', () => {
    registerListSlot('demo', 'diffRenderer', { id: 'md', extensions: ['.md'], component: DiffView });

    expect(drawText(h(DiffProbe, { path: 'src/a.ts', diff: 'x' }))).toBe('none');
    expect(drawText(h(DiffProbe, { path: 'docs/README.MD', diff: 'x' }))).toBe('diff x');
  });

  test('renders the unified diff text in the diff tab', () => {
    registerListSlot('demo', 'diffRenderer', { id: 'any', component: DiffView });

    expect(drawText(h(DiffProbe, { path: 'a.ts', diff: '@@ -1 +1 @@\n-old\n+new' }))).toContain('@@ -1 +1 @@');
  });
});
