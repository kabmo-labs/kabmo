/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What the two model dialogs TELL the user.
 *
 * Both shipped a claim the panel cannot make: the capabilities dialog hardcoded
 * "Structured Output" and "Streaming" as supported for every model on earth,
 * and the Add Model dialog could only register a chat model — so an embedding
 * or image model was written as `kind: chat` and appeared in the chat picker.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ModelCapabilitiesModal } from '@/client/components/settings/categories/provider-settings/ModelCapabilitiesModal';
import { AddModelModal } from '@/client/components/settings/categories/provider-settings/AddModelModal';
import type { ProviderItem, ProviderModel } from '@/shared/types';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;

const provider: ProviderItem = {
  id: 'omp-native-gateway',
  name: 'gateway',
  slug: 'gateway',
  icon: 'gateway',
  status: 'connected',
  configuredIn: 'models.yml',
  inModelsYml: true,
  models: [],
};

function model(overrides: Partial<ProviderModel> & { id: string }): ProviderModel {
  return {
    name: overrides.id,
    contextWindow: '128K ctx',
    hasTools: true,
    hasVision: false,
    isVisible: true,
    ...overrides,
  };
}

beforeEach(() => {
  installDomGlobals(new Window());
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  restoreDomGlobals();
});

function text(): string {
  return container.textContent ?? '';
}

describe('ModelCapabilitiesModal', () => {
  test('states what omp reports and nothing else', () => {
    act(() => {
      render(
        h(ModelCapabilitiesModal, {
          isOpen: true,
          model: model({ id: 'gpt-x', hasVision: true, hasReasoning: true, thinkingEfforts: ['low', 'high'] }),
          onClose: () => {},
        }),
        container,
      );
    });

    const body = text();
    expect(body).toContain('Image input');
    expect(body).toContain('Yes');
    // The ladder omp declared, not an invented "extended reasoning".
    expect(body).toContain('low · high');
    // The two claims the panel used to make for every model are gone.
    expect(body).not.toContain('Structured Output');
    expect(body).not.toContain('Streaming');
  });

  test('an unreported field says "not reported", which is not "no"', () => {
    act(() => {
      render(
        h(ModelCapabilitiesModal, { isOpen: true, model: model({ id: 'm' }), onClose: () => {} }),
        container,
      );
    });

    const body = text();
    expect(body).toContain('not reported');
    // The footer states the distinction the badge relies on: an absent field is
    // not a denial.
    expect(body).toContain('not the same as');
  });

  test('a non-chat kind is named', () => {
    act(() => {
      render(
        h(ModelCapabilitiesModal, { isOpen: true, model: model({ id: 'e', kind: 'embedding' }), onClose: () => {} }),
        container,
      );
    });
    expect(text()).toContain('Embedding (embedding)');
  });
});

describe('AddModelModal', () => {
  test('offers the kind picker, so a non-chat model is not registered as chat', async () => {
    act(() => {
      render(
        h(AddModelModal, {
          isOpen: true,
          provider,
          onClose: () => {},
          onAdded: () => {},
          onError: () => {},
        }),
        container,
      );
    });

    // The kind is a searchable select now: the trigger names the current value
    // and the rows are portalled, so the list is read from `document.body`.
    const trigger = container.querySelector('button[role="combobox"][aria-label="Model kind"]') as HTMLButtonElement | null;
    expect(trigger).not.toBeNull();
    expect(trigger!.textContent).toContain('Chat');

    await act(async () => {
      trigger!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    const kinds = [...document.querySelectorAll('[role="option"]')].map((option) => option.textContent);
    expect(kinds).toContain('Embedding');
    expect(kinds).toContain('Rerank');
  });
});
