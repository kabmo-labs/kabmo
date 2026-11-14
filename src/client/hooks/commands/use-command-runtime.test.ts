/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The app-wide command runtime, and the one owner `editor.run` has.
 *
 * A split column mounts the editor panel TWICE, and each pane used to register
 * `editor.run` itself. The second registration threw `command "editor.run" is
 * already registered`, and Bun's dev overlay drew that error over the whole
 * viewport — so the editor split spec's next click was intercepted by
 * `<bun-hmr>` and timed out. These cases pin both halves of the shape that
 * replaced it: the runtime is the only registrant, and the command reaches the
 * pane the user last focused.
 */

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { useCommandRuntime } from '@/client/hooks/commands/use-command-runtime';
import { useEditorCommandTarget } from '@/client/hooks/editor/use-editor-command-target';
import { useEditorPanelKeys } from '@/client/hooks/editor/use-editor-panel-keys';
import { hasCommand, runCommand } from '@/client/lib/commands/registry';
import type { EditorFindState } from '@/client/hooks/editor/use-editor-find';
import type { EditorCommand } from '@/shared/lib/code/editor/keymap';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent'] as const;
const win = new Window({ url: 'http://localhost' });
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
for (const key of DOM_GLOBALS) {
  const target = globalThis as unknown as Record<string, unknown>;
  native[key] = target[key];
  target[key] = (win as unknown as Record<string, unknown>)[key];
}

/** Each mounted pane's focus publisher, so a case can focus one by name. */
const focus: Record<string, () => void> = {};
let container: HTMLDivElement;

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) target[key] = native[key];
});

afterEach(() => {
  render(null, container);
  container.remove();
  for (const key of Object.keys(focus)) delete focus[key];
});

/** A stand-in for `Editor`: it mounts the panel keys AND publishes a target. */
function Pane({ name, log }: { name: string; log: string[] }) {
  const runCommand = (command: EditorCommand) => log.push(`${name}:${command}`);
  // The keys hook only ever reads `find` inside its callbacks, and no case here
  // dispatches a key, so an empty surface is enough to mount it for real.
  useEditorPanelKeys({ find: null as unknown as EditorFindState, runCommand });
  const target = useEditorCommandTarget({
    saveNow: () => log.push(`${name}:save`),
    runCommand,
  });
  focus[name] = target.onFocusCapture;
  return h('div', { 'data-pane': name });
}

function mount(log: string[]): void {
  container = document.createElement('div') as unknown as HTMLDivElement;
  document.body.appendChild(container as never);
  function App() {
    useCommandRuntime();
    // Two panes, exactly like a split column.
    return h('div', null, h(Pane, { name: 'left', log }), h(Pane, { name: 'right', log }));
  }
  act(() => render(h(App, {}), container));
}

describe('the app command runtime', () => {
  test('two editor panes mount without claiming editor.run twice', () => {
    const log: string[] = [];
    mount(log);

    expect(Object.keys(focus)).toEqual(['left', 'right']);
    expect(hasCommand('editor.run')).toBe(true);
  });

  test('editor.run reaches the pane that was focused last', () => {
    const log: string[] = [];
    mount(log);

    act(() => focus.right());
    act(() => {
      runCommand('editor.run', { command: 'goToLine' });
    });

    act(() => focus.left());
    act(() => {
      runCommand('editor.run', { command: 'toggleWordWrap' });
    });

    expect(log).toEqual(['right:goToLine', 'left:toggleWordWrap']);
  });

  test('editor.run with no command argument runs nothing', () => {
    const log: string[] = [];
    mount(log);

    act(() => focus.left());
    act(() => {
      runCommand('editor.run');
      runCommand('editor.run', {});
    });

    expect(log).toEqual([]);
  });
});
