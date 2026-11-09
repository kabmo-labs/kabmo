/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The provider panel, as the two measured bugs and the user's rule define it.
 *
 *  - **Custom only.** `anthropic` lives in the same models.yml as `kenari` and
 *    must never be offered: copying it into another agent writes an override of
 *    that agent's OWN built-in provider. The server filters it (`vendors.ts`);
 *    this pins what the card RENDERS.
 *  - **A row states the source's protocol and the target's list, not a verdict.**
 *    The import is what decides, by probing the endpoint — `kenari` declares Chat
 *    Completions and lands in Claude Code through Anthropic Messages. A row that
 *    said "won't work" here would have hidden the one import that works.
 *  - **The env form clears itself on a successful save.** Reading the `problem`
 *    state right after `setProblem(...)` held the PREVIOUS save's value, so a
 *    successful write reported failure and kept its fields filled.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { HarnessProviderPanel } from '@/client/components/settings/categories/harness-settings/ProviderPanel';
import type { HarnessProviderSupport } from '@/shared/types/harness';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;

function support(overrides: Partial<HarnessProviderSupport> = {}): HarnessProviderSupport {
  return {
    level: 'full',
    file: '.omp/agent/models.yml',
    fileLabel: 'models.yml (omp)',
    summary: 'omp keeps providers in models.yml.',
    createsChoice: true,
    pointer: 'providers',
    credentialLabel: 'apiKey',
    protocols: ['openai-chat', 'anthropic-messages'],
    configured: [],
    importable: [],
    ...overrides,
  };
}

const KENARI = {
  id: 'kenari',
  name: 'Kenari',
  baseUrl: 'https://kenari.id/v1',
  dialect: 'openai-completions',
  protocol: 'openai-chat' as const,
  models: ['claude-sonnet-5'],
  source: 'omp-rpc',
  hasKey: true,
};

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

function buttons(): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')];
}

describe('the import list', () => {
  test('a custom provider is offered with its SOURCE and its declared protocol', () => {
    render(h(HarnessProviderPanel, { support: support({ importable: [KENARI] }) }), container);
    const text = container.textContent ?? '';
    expect(text).toContain('Kenari');
    expect(text).toContain('omp-rpc');
    expect(text).toContain('https://kenari.id/v1');
    // The source's own protocol, named on the shared vocabulary.
    expect(text).toContain('OpenAI Chat Completions');
    // And what THIS agent can take, so the refusal is visible early.
    expect(text).toContain('Anthropic Messages');
    expect(text).toContain('key stored');
  });

  test('an IMPORT button is present and never disabled by the declaration alone', () => {
    // `kenari` declares a protocol `claude` does not store; the probe decides, so
    // the button stays live.
    render(
      h(HarnessProviderPanel, {
        support: support({
          level: 'environment',
          env: { baseUrl: 'ANTHROPIC_BASE_URL', apiKey: 'ANTHROPIC_AUTH_TOKEN', model: 'ANTHROPIC_MODEL' },
          protocols: ['anthropic-messages'],
          importable: [KENARI],
        }),
        onImport: async () => ({ problem: null, detail: null }),
      }),
      container,
    );
    const importButton = buttons().find((button) => button.textContent?.includes('Import'));
    expect(importButton).toBeDefined();
    expect(importButton?.disabled).toBe(false);
  });

  test('an empty list says so instead of drawing a dead section', () => {
    render(h(HarnessProviderPanel, { support: support({ importable: [] }) }), container);
    expect(container.textContent).toContain('Nothing to import yet');
    expect(buttons().some((button) => button.textContent?.includes('Import'))).toBe(false);
  });

  test('a successful import shows the EVIDENCE, not just "copied"', async () => {
    render(
      h(HarnessProviderPanel, {
        support: support({ importable: [KENARI] }),
        onImport: async () => ({
          problem: null,
          detail: 'anthropic-messages → models.yml (omp) · set ANTHROPIC_AUTH_TOKEN',
        }),
      }),
      container,
    );
    const importButton = buttons().find((button) => button.textContent?.includes('Import'))!;
    await act(async () => {
      importButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const text = container.textContent ?? '';
    expect(text).toContain('Copied kenari into models.yml (omp)');
    expect(text).toContain('anthropic-messages');
    expect(text).toContain('ANTHROPIC_AUTH_TOKEN');
  });

  test('a refusal is printed verbatim, with the reason the route gave', async () => {
    render(
      h(HarnessProviderPanel, {
        support: support({ importable: [KENARI] }),
        onImport: async () => ({ problem: 'antigravity has no protocol that matches kenari', detail: null }),
      }),
      container,
    );
    const importButton = buttons().find((button) => button.textContent?.includes('Import'))!;
    await act(async () => {
      importButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('antigravity has no protocol that matches kenari');
  });
});

describe('the env form', () => {
  test('a successful save CLEARS its fields — the second save is not blocked by a stale problem', async () => {
    let calls = 0;
    render(
      h(HarnessProviderPanel, {
        support: support({
          level: 'environment',
          env: { baseUrl: 'ANTHROPIC_BASE_URL', apiKey: 'ANTHROPIC_AUTH_TOKEN' },
          protocols: ['anthropic-messages'],
          importable: [],
        }),
        onSaveEnv: async () => {
          calls += 1;
          return null;
        },
      }),
      container,
    );
    const inputs = [...container.querySelectorAll('input')] as HTMLInputElement[];
    expect(inputs).toHaveLength(2);
    await act(async () => {
      inputs[0]!.value = 'https://kenari.id';
      inputs[0]!.dispatchEvent(new Event('input', { bubbles: true }));
      inputs[1]!.value = 'kn-key';
      inputs[1]!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const save = buttons().find((button) => button.textContent?.includes('Save to environment'))!;
    expect(save.disabled).toBe(false);
    await act(async () => {
      save.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(calls).toBe(1);
    // Cleared, and no error text left behind.
    const after = [...container.querySelectorAll('input')] as HTMLInputElement[];
    expect(after[0]!.value).toBe('');
    expect(after[1]!.value).toBe('');
    expect(container.textContent).not.toContain('Save to environment failed');
    // One input carrying the class ONCE — the duplicate `class`/`className` pair
    // was a JSX-precompile hazard, not a style choice.
    expect(container.querySelector('input')?.getAttribute('class')).toContain('font-mono');
  });

  test('each alias field writes its own variable; a blank one writes nothing', async () => {
    let saved = '';
    render(
      h(HarnessProviderPanel, {
        support: support({
          level: 'environment',
          env: {
            baseUrl: 'ANTHROPIC_BASE_URL',
            apiKey: 'ANTHROPIC_AUTH_TOKEN',
            model: 'ANTHROPIC_MODEL',
            modelAliases: [
              { family: 'sonnet', env: 'ANTHROPIC_DEFAULT_SONNET_MODEL' },
              { family: 'haiku', env: 'ANTHROPIC_DEFAULT_HAIKU_MODEL' },
            ],
          },
          protocols: ['anthropic-messages'],
          importable: [],
        }),
        onSaveEnv: async (env) => {
          saved = env;
          return null;
        },
      }),
      container,
    );
    const inputs = [...container.querySelectorAll('input')] as HTMLInputElement[];
    expect(inputs).toHaveLength(5);
    await act(async () => {
      const values = ['https://kenari.id', 'kn-key', 'qwen3-8-27b:free', 'claude-sonnet-5-5', ''];
      inputs.forEach((input, index) => {
        input.value = values[index]!;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });
    const save = buttons().find((button) => button.textContent?.includes('Save to environment'))!;
    await act(async () => {
      save.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(saved).toBe([
      'ANTHROPIC_BASE_URL=https://kenari.id',
      'ANTHROPIC_AUTH_TOKEN=kn-key',
      'ANTHROPIC_MODEL=qwen3-8-27b:free',
      'ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-5-5',
    ].join('\n'));
    expect([...container.querySelectorAll('input')].every((input) => input.value === '')).toBe(true);
  });
});

describe('the add-provider form', () => {
  test('the id under the field is the key that will land', async () => {
    render(
      h(HarnessProviderPanel, {
        support: support({ importable: [] }),
        onAddProvider: async () => ({ problem: null, detail: null }),
      }),
      container,
    );
    const open = buttons().find((button) => button.textContent?.includes('Add provider'))!;
    expect(open).toBeDefined();
    await act(async () => {
      open.click();
      await Promise.resolve();
    });
    // Typing a name previews the derived id, so "My Gateway (EU)" is never saved
    // under a name the reader did not see.
    const field = container.querySelector('input') as HTMLInputElement;
    await act(async () => {
      field.value = 'My Gateway (EU)';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.textContent).toContain('my-gateway-eu');
  });

  test('Add is blocked until a name exists, and a failure keeps the values', async () => {
    let calls = 0;
    render(
      h(HarnessProviderPanel, {
        support: support({ importable: [] }),
        onAddProvider: async () => {
          calls += 1;
          return { problem: 'omp-acp cannot speak anthropic-messages', detail: null };
        },
      }),
      container,
    );
    await act(async () => {
      (buttons().find((b) => b.textContent?.includes('Add provider')) as HTMLButtonElement).click();
      await Promise.resolve();
    });
    const add = () => buttons().find((b) => b.textContent?.trim() === 'Add') as HTMLButtonElement;
    expect(add().disabled).toBe(true);

    const [nameField, urlField] = [...container.querySelectorAll('input')] as HTMLInputElement[];
    await act(async () => {
      nameField!.value = 'Gateway';
      nameField!.dispatchEvent(new Event('input', { bubbles: true }));
      urlField!.value = 'https://gw.example/v1';
      urlField!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(add().disabled).toBe(false);
    await act(async () => {
      add().click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(calls).toBe(1);
    expect(container.textContent).toContain('omp-acp cannot speak anthropic-messages');
    // A refusal must NOT clear the form — the reader fixes it and retries.
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('Gateway');
  });
});
