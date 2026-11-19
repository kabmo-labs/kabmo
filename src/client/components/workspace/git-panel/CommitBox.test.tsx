/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { h as PreactH, render as PreactRender } from 'preact';
import type { act as PreactAct } from 'preact/test-utils';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { GitCommitBox as GitCommitBoxComponent } from '@/client/components/workspace/git-panel/CommitBox';

// Preact and the component are imported DYNAMICALLY in `beforeAll`, after
// `installDomGlobals` has put a window on the global: a static import would
// evaluate Preact against the runner's windowless global and the render would
// fail before the first case. Same reason `commit-box.test.ts` does.
let GitCommitBox: typeof GitCommitBoxComponent;
let h: typeof PreactH;
let render: typeof PreactRender;
let act: typeof PreactAct;
let container: HTMLElement;

beforeAll(async () => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  ({ GitCommitBox } = await import('@/client/components/workspace/git-panel/CommitBox'));
  ({ h, render } = await import('preact'));
  ({ act } = await import('preact/test-utils'));
});

afterAll(() => {
  restoreDomGlobals();
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

function mount(props: Partial<Parameters<typeof GitCommitBox>[0]> = {}) {
  const calls = { generate: 0, use: 0, dismiss: 0, commit: 0 };
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    render(h(GitCommitBox, {
      message: '',
      hasStagedChanges: true,
      onChangeMessage: () => {},
      onCommit: () => { calls.commit += 1; },
      onGenerate: () => { calls.generate += 1; },
      onUseSuggestion: () => { calls.use += 1; },
      onDismissSuggestion: () => { calls.dismiss += 1; },
      ...props,
    }), container);
  });
  return calls;
}

function button(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')]
    .find((entry) => entry.textContent?.includes(label)) as HTMLButtonElement | undefined;
}

describe('GitCommitBox generate action', () => {
  test('is disabled until something is staged', () => {
    mount({ hasStagedChanges: false });
    const generate = button('Generate');
    expect(generate?.disabled).toBe(true);
    expect(generate?.title).toBe('Stage changes first');
  });

  test('runs the generator when staged changes exist', () => {
    const calls = mount({ hasStagedChanges: true });
    const generate = button('Generate');
    expect(generate?.disabled).toBe(false);
    act(() => generate?.click());
    expect(calls.generate).toBe(1);
  });

  test('shows the generating state and blocks a second click', () => {
    mount({ isGenerating: true });
    const generate = button('Generating');
    expect(generate?.disabled).toBe(true);
  });

  test('a suggestion is offered, not written into the draft', () => {
    const calls = mount({ message: 'my own message', suggestion: 'feat: generated' });
    expect(container.textContent).toContain('feat: generated');
    act(() => button('Use')?.click());
    act(() => button('Dismiss')?.click());
    expect(calls.use).toBe(1);
    expect(calls.dismiss).toBe(1);
  });

  test('marks a draft that came from the generator', () => {
    mount({ message: 'feat: generated', generated: true });
    expect(container.textContent).toContain('Generated from staged changes');
  });
});
