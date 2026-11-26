/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor column's two chrome rows and the right column's header are ONE
 * height.
 *
 * Measured in Chromium at 1365x768 before this test existed: the editor strip
 * sized itself from its own chips (`py-1.5` + `border-t-2` = 31px) and its
 * toolbar from `py-2` around 27px of controls (43px), against the right
 * column's 40px strip and 40px header. The first separator landed at y=71 in
 * one column and y=80 in the other, and the document began at 114 against 120 —
 * which reads as two panels that are not on the same grid.
 *
 * happy-dom lays nothing out, so the assertion is the CLASS the rows carry: all
 * three read `CONTROL_ROW_HEIGHT.desktop`, and that constant is 40px. A row that
 * invents its own padding again fails here.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import type { ComponentChildren } from 'preact';
import { act } from 'preact/test-utils';

import { SessionStateContext } from '@/client/hooks/workspace/session-state/context';
import { CONTROL_ROW_HEIGHT } from '@/client/lib/ui/control-plate';
import { PanelHeader } from '@/client/components/workspace/panel-header';
import { EditorTabs } from '@/client/components/workspace/editor/Tabs';
import { EditorToolbar } from '@/client/components/workspace/editor/Toolbar';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { OpenedFile } from '@kabmo-labs/kabmo-app-contracts/fs';

const FILES: OpenedFile[] = [{ id: 1, name: 'keep.ts', path: 'src/keep.ts' }];

let container: HTMLElement;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterAll(() => {
  restoreDomGlobals();
});

afterEach(() => {
  if (!container) return;
  render(null, container);
  container.remove();
});

async function mount(children: ComponentChildren): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(
      h(
        SessionStateContext.Provider,
        { value: { sessionId: 'chrome-rows', ready: false } },
        children,
      ),
      container,
    );
  });
  return container;
}

function toolbar() {
  return h(EditorToolbar, {
    path: 'src/keep.ts',
    saveStatus: 'idle',
    wordWrap: false,
    hasPreview: false,
    isPreview: false,
    hasReview: false,
    isReviewing: false,
    copied: false,
    canReload: true,
    reloadDiscardsEdits: false,
    onToggleFind: () => {},
    onSave: () => {},
    onTogglePreview: () => {},
    onToggleReview: () => {},
    onToggleWordWrap: () => {},
    onZoomIn: () => {},
    onZoomOut: () => {},
    onCopy: () => {},
    onDownload: () => {},
    onReload: () => {},
    onSaveAs: () => {},
    onToggleMaximize: () => {},
  });
}

describe('editor chrome rows', () => {
  test('the shared row height is the 40px chrome row', () => {
    expect(CONTROL_ROW_HEIGHT.desktop).toBe('h-10');
  });

  test('the tab strip is that row', async () => {
    const el = await mount(
      h(EditorTabs, {
        openedFiles: FILES,
        activeFileId: 1,
        onSelectFile: () => {},
        onCloseFile: () => {},
      }),
    );
    const strip = el.firstElementChild as HTMLElement;
    expect(strip.className).toContain(CONTROL_ROW_HEIGHT.desktop);
  });

  test('the toolbar is that row, so it ends on the right panel header line', async () => {
    const el = await mount(toolbar());
    const row = el.firstElementChild as HTMLElement;
    expect(row.className).toContain(CONTROL_ROW_HEIGHT.desktop);
  });

  test('the right panel header is that row', async () => {
    const el = await mount(h(PanelHeader, { left: h('span', null, 'picker') }));
    const strip = el.firstElementChild as HTMLElement;
    expect(strip.className).toContain(CONTROL_ROW_HEIGHT.desktop);
  });
});
