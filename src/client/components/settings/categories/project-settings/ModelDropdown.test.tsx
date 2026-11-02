/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * "Defaults for new chats" — the value it stores and the row it renders.
 *
 * The control used to offer a hardcoded list of display names that no spawn
 * could read; the stored value is now the composite `provider:modelId` the
 * spawn applies, so these cases pin that the picker emits exactly that string,
 * names the provider on every row (the registry serves one id from several
 * providers), and can clear back to "inherit".
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { ProjectModelDropdown } from '@/client/components/settings/categories/project-settings/ModelDropdown';
import type { ProjectModelChoice } from '@/client/hooks/settings/projects';
import { NO_PROJECT_MODEL } from '@/shared/lib/workspace/project-model';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const MODELS: ProjectModelChoice[] = [
  { provider: 'kenari', id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
  { provider: 'deepseek', id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
  { provider: 'openai', id: 'gpt-5', name: 'GPT-5' },
];

let container: HTMLElement;
const picks: string[] = [];

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  picks.length = 0;
});

afterAll(() => {
  restoreDomGlobals();
});

function mount(model: string, models: ProjectModelChoice[] = MODELS): HTMLElement {
  container = document.body.appendChild(document.createElement('div'));
  act(() =>
    render(
      h(ProjectModelDropdown, {
        model,
        models,
        onSelectModel: (value: string) => picks.push(value),
      }),
      container,
    ),
  );
  return container;
}

function clickText(root: HTMLElement, text: string): void {
  const target = [...root.querySelectorAll('button')].find((button) => button.textContent?.includes(text));
  if (!target) throw new Error(`no button containing “${text}”`);
  act(() => target.click());
}

function openPicker(root: HTMLElement): void {
  // The trigger is the only button whose text starts with a model label or the
  // inherit label, and it is the first button in the component.
  const trigger = root.querySelector('button');
  if (!trigger) throw new Error('no trigger');
  act(() => trigger.click());
}

describe('ProjectModelDropdown', () => {
  test('an unset project says it inherits Kabmo’s default', () => {
    const root = mount(NO_PROJECT_MODEL);
    const trigger = [...root.querySelectorAll('button')].find((button) => button.textContent?.includes('Inherit Kabmo'));
    expect(trigger).toBeTruthy();
  });

  test('a stored model is labelled with its provider and display name', () => {
    const root = mount('kenari:deepseek-v4-flash');
    expect(root.textContent).toContain('kenari · DeepSeek V4 Flash');
  });

  test('a stale stored model is still named rather than reading as "inherit"', () => {
    const root = mount('kenari:gone');
    expect(root.textContent).toContain('kenari · gone');
    expect(root.textContent).not.toContain('Inherit Kabmo');
  });

  test('picking a row emits the composite provider:modelId value', () => {
    const root = mount(NO_PROJECT_MODEL);
    openPicker(root);
    // Both providers serve this id: the row clicked must decide the provider.
    const rows = [...root.querySelectorAll('button')].filter(
      (button) => button.textContent?.includes('DeepSeek V4 Flash'),
    );
    expect(rows).toHaveLength(2);
    const deepseek = rows.find((button) => button.textContent?.includes('deepseek'));
    if (!deepseek) throw new Error('no deepseek row');
    act(() => deepseek.click());
    expect(picks).toEqual(['deepseek:deepseek-v4-flash']);
  });

  test('clearing returns the project to inheriting', () => {
    const root = mount('openai:gpt-5');
    openPicker(root);
    clickText(root, 'Clear the project model');
    expect(picks).toEqual([NO_PROJECT_MODEL]);
  });

  test('an empty catalog explains itself instead of offering nothing', () => {
    const root = mount(NO_PROJECT_MODEL, []);
    openPicker(root);
    expect(root.textContent).toContain('The catalog is empty.');
  });
});
