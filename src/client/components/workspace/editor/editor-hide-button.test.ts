/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor column's own switch, in its top-right corner.
 *
 * It moved there from the top navbar, where it sat beside the control that now
 * hides the whole right side. The rule the cases pin is the one the move could
 * silently break: the column is ONE panel drawn by three states — a file tab, an
 * empty column and a plugin takeover — and every one of them has to offer the
 * same switch, or the column becomes unclosable in the state the user is in.
 *
 * Rendered with `h()` against happy-dom; the components are imported after the
 * globals exist, as `Tabs.test.ts` does.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { h as PreactH, render as PreactRender } from 'preact';
import type { act as PreactAct } from 'preact/test-utils';
import type { EditorTabs as EditorTabsComponent } from '@/client/components/workspace/editor/Tabs';
import type { EmptyEditor as EmptyEditorComponent } from '@/client/components/workspace/editor/EmptyEditor';

let EditorTabs: typeof EditorTabsComponent;
let EmptyEditor: typeof EmptyEditorComponent;
let h: typeof PreactH;
let render: typeof PreactRender;
let act: typeof PreactAct;

let container: HTMLElement;
const installed: Record<string, unknown> = {};
const displaced: Record<string, unknown> = {};

beforeAll(async () => {
  const win = new Window({ url: 'http://localhost' });
  for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'ResizeObserver'] as const) {
    displaced[key] = (globalThis as Record<string, unknown>)[key];
    installed[key] = (win as unknown as Record<string, unknown>)[key];
    (globalThis as Record<string, unknown>)[key] = installed[key];
  }
  // Dynamic on purpose: Preact reads `document` at import time, so the module
  // cannot be loaded until happy-dom's globals are installed above.
  ({ EditorTabs } = await import('@/client/components/workspace/editor/Tabs'));
  ({ EmptyEditor } = await import('@/client/components/workspace/editor/EmptyEditor'));
  ({ h, render } = await import('preact'));
  ({ act } = await import('preact/test-utils'));
});

afterAll(() => {
  for (const key of Object.keys(installed)) {
    if (displaced[key] === undefined) delete (globalThis as Record<string, unknown>)[key];
    else (globalThis as Record<string, unknown>)[key] = displaced[key];
  }
});

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

/** The switch, by the label it carries — the chord suffix is not its identity. */
function hideButton(): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>('button[aria-label^="Hide Editor Panel"]');
}

describe('the editor column’s corner switch', () => {
  test('the tab strip draws it, and it calls back', async () => {
    let calls = 0;
    await act(async () => {
      render(
        h(EditorTabs, {
          openedFiles: [{ id: 1, name: 'a.ts', path: 'src/a.ts' }],
          activeFileId: 1,
          onSelectFile: () => {},
          onCloseFile: () => {},
          onHide: () => {
            calls += 1;
          },
        }),
        container,
      );
    });
    await act(async () => {});

    const button = hideButton();
    expect(button).not.toBeNull();
    // The chord is named in the tooltip, so the button and the keymap cannot
    // drift — the same rule every toolbar control follows.
    expect(button!.getAttribute('title')).toContain('Ctrl+J');

    await act(async () => {
      button!.click();
    });
    expect(calls).toBe(1);
  });

  test('an empty column draws it too: a column with nothing in it is still a column', async () => {
    let calls = 0;
    await act(async () => {
      render(
        h(EmptyEditor, {
          onHide: () => {
            calls += 1;
          },
        }),
        container,
      );
    });
    await act(async () => {});

    const button = hideButton();
    expect(button).not.toBeNull();
    await act(async () => {
      button!.click();
    });
    expect(calls).toBe(1);
  });

  test('a caller that passes no handler draws no switch, not a dead button', async () => {
    await act(async () => {
      render(
        h(EditorTabs, {
          openedFiles: [{ id: 1, name: 'a.ts', path: 'src/a.ts' }],
          activeFileId: 1,
          onSelectFile: () => {},
          onCloseFile: () => {},
        }),
        container,
      );
    });
    await act(async () => {});

    // A split pane passes nothing: the split's right pane has no chrome of its
    // own, and the column is one panel.
    expect(hideButton()).toBeNull();
  });
});
