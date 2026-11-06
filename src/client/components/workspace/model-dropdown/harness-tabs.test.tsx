/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The composer's harness tabs.
 *
 * The behaviour that matters is what a user is TOLD, because the alternative is
 * a control that looks available and refuses:
 *
 *  - a harness that cannot run here is disabled AND carries the agent's own
 *    reason (`mcode login`, `executable not found (command: pi)`);
 *  - a chat that already has a transcript cannot change harness — the tab says
 *    "start a new chat" instead of switching the transport under a live run;
 *  - the active tab is marked for assistive tech, not by colour alone.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { HarnessTabs, harnessBlockedReason } from '@/client/components/workspace/model-dropdown/HarnessTabs';
import type { HarnessSummary } from '@/shared/types/harness';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'MouseEvent', 'KeyboardEvent'] as const;
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

function summary(id: string, overrides: Partial<HarnessSummary> = {}): HarnessSummary {
  return { id, label: id, transport: 'acp', canLaunch: true, probe: null, ...overrides };
}

const probeBlocked = (reason: string) => ({
  harness: 'claude',
  capabilities: {
    configModel: 0, configThinking: 0, configMode: 0, modeValues: [],
    loadSession: false, listSessions: false, forkSession: false, deleteSession: false,
    resumeSession: false, closeSession: false, hasUsage: false, hasPlan: false,
    steerMode: null, blocked: reason,
  },
  models: [], thinking: [], modes: [], probedAt: Date.now(),
});

async function mount(node: preact.ComponentChild) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(node, container);
  });
  return container;
}

describe('harness tabs', () => {
  test('a runnable harness is a selectable tab', async () => {
    const picked: string[] = [];
    const el = await mount(h(HarnessTabs, {
      harnesses: [summary('omp-rpc'), summary('claude')],
      active: 'omp-rpc',
      editable: true,
      onSelect: (id: string) => picked.push(id),
    }));
    const tabs = el.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    await act(async () => {
      (tabs[1] as HTMLElement).click();
    });
    expect(picked).toEqual(['claude']);
  });

  test('an uninstalled harness is disabled and names the install command', async () => {
    const el = await mount(h(HarnessTabs, {
      harnesses: [summary('pi', { canLaunch: false, unavailable: '`pi` is not installed', install: 'npm i -g pi-acp' })],
      active: null,
      editable: true,
      onSelect: () => {},
    }));
    const tab = el.querySelector('[role="tab"]') as HTMLButtonElement;
    expect(tab.disabled).toBe(true);
    expect(tab.getAttribute('title')).toContain('not installed');
    expect(tab.getAttribute('title')).toContain('npm i -g pi-acp');
  });

  test("a probe's own refusal becomes the tab's reason", async () => {
    const blocked = summary('claude', { probe: probeBlocked('Authentication required: Run `mcode login` and try again.') });
    expect(harnessBlockedReason(blocked)).toContain('mcode login');
  });

  test('the built-in transport is never blocked, even with a cached refusal', () => {
    // `omp` over RPC is the default every session already runs on. A probe of it
    // can only answer "no launch command is configured" — there is no agent to
    // spawn — and that record, once cached, painted a ⚠ over the tab and
    // DISABLED it, so the default harness could not be selected at all.
    const poisoned = summary('omp-rpc', {
      builtIn: true,
      probe: probeBlocked('No launch command is configured for this harness'),
    });
    expect(harnessBlockedReason(poisoned)).toBeNull();
  });

  test('the built-in tab stays clickable and carries no warning mark', async () => {
    const picked: string[] = [];
    const el = await mount(h(HarnessTabs, {
      harnesses: [
        summary('omp-rpc', { builtIn: true, probe: probeBlocked('No launch command is configured for this harness') }),
        summary('claude'),
      ],
      active: 'claude',
      editable: true,
      onSelect: (id: string) => picked.push(id),
    }));
    const tab = el.querySelectorAll('[role="tab"]')[0] as HTMLButtonElement;
    expect(tab.disabled).toBe(false);
    expect(tab.getAttribute('aria-disabled')).toBe('false');
    expect(tab.textContent).not.toContain('⚠');
    await act(async () => {
      tab.click();
    });
    expect(picked).toEqual(['omp-rpc']);
  });

  test('a chat with a transcript cannot switch harness', async () => {
    const picked: string[] = [];
    const el = await mount(h(HarnessTabs, {
      harnesses: [summary('omp-rpc'), summary('claude')],
      active: 'omp-rpc',
      editable: false,
      onSelect: (id: string) => picked.push(id),
    }));
    const tab = el.querySelectorAll('[role="tab"]')[1] as HTMLButtonElement;
    expect(tab.getAttribute('title')).toContain('Start a new chat');
    await act(async () => {
      tab.click();
    });
    expect(picked).toEqual([]);
  });

  test('the glyph travels with the label', async () => {
    const el = await mount(h(HarnessTabs, {
      harnesses: [summary('codex')],
      active: 'codex',
      editable: true,
      onSelect: () => {},
    }));
    expect(el.querySelector('[data-harness="codex"]')).not.toBeNull();
  });

  test('no harnesses draws nothing rather than an empty strip', async () => {
    const el = await mount(h(HarnessTabs, { harnesses: [], active: null, editable: true, onSelect: () => {} }));
    expect(el.querySelector('[role="tablist"]')).toBeNull();
  });
});
