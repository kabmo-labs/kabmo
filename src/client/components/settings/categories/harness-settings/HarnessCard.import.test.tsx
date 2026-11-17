/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The import controls on one harness card.
 *
 * The switch is the consent for the background pass, so it must exist, start
 * OFF, and call the server with the harness the card names. The manual button
 * is independent and reports the counts it received — a zero that read as
 * success is the substitution this feature is supposed to avoid.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { HarnessCard } from '@/client/components/settings/categories/harness-settings/HarnessCard';
import { UNKNOWN_CAPABILITIES } from '@/shared/types/harness';
import type { HarnessSummary } from '@/shared/types/harness';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;

function summary(overrides: Partial<HarnessSummary> = {}): HarnessSummary {
  return {
    id: 'codex',
    label: 'codex',
    transport: 'acp',
    canLaunch: true,
    enabled: true,
    autoImport: false,
    probe: {
      harness: 'codex',
      capabilities: { ...UNKNOWN_CAPABILITIES, listSessions: true, agentName: 'codex' },
      models: [],
      thinking: [],
      modes: [],
      probedAt: Date.now(),
    },
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

function switchButton(): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((button) => button.getAttribute('role') === 'switch');
  if (!found) throw new Error('no auto-import switch rendered');
  return found as HTMLButtonElement;
}

function importButton(): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Import sessions'));
  if (!found) throw new Error('no manual import button rendered');
  return found as HTMLButtonElement;
}

describe('import controls', () => {
  test('the switch starts off and toggling it names this harness', async () => {
    const calls: Array<[string, boolean]> = [];
    render(
      h(HarnessCard, {
        summary: summary(),
        onProbe: async () => null,
        onSetAutoImport: async (id, enabled) => {
          calls.push([id, enabled]);
          return { autoImport: enabled, result: null, error: null };
        },
      }),
      container,
    );
    expect(switchButton().getAttribute('aria-checked')).toBe('false');
    // The label must live OUTSIDE the switch element: the theme paints
    // `[role=switch][aria-checked]` with success/error, and a label inside it
    // becomes unreadable text on a green background (measured).
    expect(switchButton().textContent?.trim()).toBe('');
    await act(async () => {
      switchButton().click();
      await Promise.resolve();
    });
    expect(calls).toEqual([['codex', true]]);
  });

  test('the switch renders the server\'s state, which defaults to ON', () => {
    render(
      h(HarnessCard, {
        summary: summary({ autoImport: true }),
        onProbe: async () => null,
        onSetAutoImport: async (_id, enabled) => ({ autoImport: enabled, result: null, error: null }),
      }),
      container,
    );
    expect(switchButton().getAttribute('aria-checked')).toBe('true');
  });

  test('the manual button reports imported and already-listed counts', async () => {
    render(
      h(HarnessCard, {
        summary: summary(),
        onProbe: async () => null,
        onImportSessions: async () => ({ result: { harness: 'codex', imported: 2, known: 1, outside: 0, empty: 0, deleted: 0 }, error: null }),
      }),
      container,
    );
    await act(async () => {
      importButton().click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('2 imported · 1 already listed');
  });
});
