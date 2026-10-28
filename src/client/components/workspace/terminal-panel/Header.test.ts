/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The terminal header's right cluster.
 *
 * It used to carry the shell's working directory and the checked-out branch
 * beside the shell name. The directory is a long absolute path that pushed the
 * rest of the header around and told the user nothing the shell prompt does not
 * already say, and the branch belonged to the same working tree the repo picker
 * names — so both were removed. These cases pin what the cluster still shows:
 * the shell's own name, and nothing that reads as a path or a branch.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { TerminalHeader } from '@/client/components/workspace/terminal-panel/Header';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent'] as const;
/** The runner's own globals, restored on teardown — deleting them would strip natives (Event/CustomEvent) every later file needs. */
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let container: HTMLElement;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

async function mount(shell?: string) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(
      h(TerminalHeader, {
        status: 'running',
        exitCode: null,
        rootPath: '/Users/dev/projects/workspace',
        activeRepo: '.',
        onSelectRepo: () => {},
        repos: ['.'],
        reposScanning: false,
        onRefreshRepos: () => {},
        shell,
        onRestart: () => {},
      }),
      container,
    );
  });
  return container;
}

describe('terminal header', () => {
  test('the right cluster names the shell by its basename', async () => {
    const el = await mount('/bin/zsh');
    const labels = Array.from(el.querySelectorAll('span')).map((span) => span.textContent?.trim() ?? '');
    expect(labels).toContain('zsh');
    expect(labels).not.toContain('/bin/zsh');
  });

  test('no working directory or branch is drawn', async () => {
    const el = await mount('/bin/bash');
    const text = el.textContent ?? '';
    // The root is passed to the repo picker, which names it by folder — the
    // absolute path itself must not appear anywhere in the bar.
    expect(text).not.toContain('/Users/dev/projects/workspace');
    expect(text).not.toMatch(/\b(main|master)\b/);
    expect(text).toContain('bash');
  });

  test('a header with no shell yet draws no right cluster', async () => {
    const el = await mount(undefined);
    const labels = Array.from(el.querySelectorAll('span')).map((span) => span.textContent?.trim() ?? '');
    expect(labels).not.toContain('');
    expect(el.textContent).toContain('Terminal');
  });
});
