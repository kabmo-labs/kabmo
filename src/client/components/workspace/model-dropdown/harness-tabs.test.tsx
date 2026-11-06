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

import { HarnessTabs, harnessBlock, harnessBlockedReason, harnessTabTitle } from '@/client/components/workspace/model-dropdown/HarnessTabs';
import { HARNESS_GLYPH_SIZE } from '@/client/components/common/harness-glyph';
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
  return { id, label: id, transport: 'acp', canLaunch: true, enabled: true, probe: null, ...overrides };
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

  test('an uninstalled harness is marked unusable, keeps its reason, and opens the fix', async () => {
    const fixes: string[] = [];
    const el = await mount(h(HarnessTabs, {
      harnesses: [summary('pi', { canLaunch: false, unavailable: '`pi` is not installed', install: 'npm i -g pi-acp' })],
      active: null,
      editable: true,
      onSelect: () => {},
      onFix: (id: string) => fixes.push(id),
    }));
    const tab = el.querySelector('[role="tab"]') as HTMLButtonElement;
    // `aria-disabled`, never the native attribute: measured in Chromium, a
    // `<button disabled>` never shows its `title` and never delivers a click, so
    // the reason — the whole point of a blocked tab — was unreachable.
    expect(tab.disabled).toBe(false);
    expect(tab.getAttribute('aria-disabled')).toBe('true');
    expect(tab.getAttribute('title')).toContain('not installed');
    expect(tab.getAttribute('title')).toContain('npm i -g pi-acp');
    await act(async () => {
      tab.click();
    });
    expect(fixes).toEqual(['pi']);
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
      harnesses: [summary('omp-rpc', { label: 'omp' }), summary('claude')],
      active: 'omp-rpc',
      editable: false,
      onSelect: (id: string) => picked.push(id),
    }));
    const tabs = el.querySelectorAll('[role="tab"]');
    const claude = tabs[1] as HTMLButtonElement;
    // The sentence has to name the agent the chat ALREADY started on. "Start a
    // new chat to use claude" was true and useless: it never said which agent
    // held the chat, so a user could not tell a lock from their own mistake.
    expect(claude.getAttribute('title')).toContain('this chat already started on omp');
    expect(claude.getAttribute('title')).toContain('Start a new chat to use claude');
    // The same sentence on the accessible path: an `aria-disabled` tab is still
    // focusable, and a screen reader would otherwise hear "claude, tab, dimmed"
    // with no reason attached.
    expect(claude.getAttribute('aria-description')).toBe(claude.getAttribute('title'));
    // The active tab is not offered as an alternative to itself.
    expect(tabs[0]?.getAttribute('title')).toContain('already started on');
    expect(tabs[0]?.getAttribute('title')).not.toContain('Cannot switch');
    // Unusable, but still pressable: `title` is unreachable on a native
    // `disabled` button (measured in Chromium), and this tab's whole job here is
    // to explain itself.
    expect(claude.disabled).toBe(false);
    expect(claude.getAttribute('aria-disabled')).toBe('true');
    await act(async () => {
      claude.click();
    });
    expect(picked).toEqual([]);
  });

  test('a tab with nothing wrong answers with the agent it would start', () => {
    const probed = summary('claude', {
      probe: {
        ...probeBlocked(''),
        capabilities: { ...probeBlocked('').capabilities, blocked: undefined, agentName: 'claude-code', agentVersion: '2.0.1' },
      },
    });
    expect(harnessTabTitle(probed, { block: null, editable: true, active: null })).toBe('claude · claude-code 2.0.1');
    // No probe yet: the label, not a fabricated build string.
    expect(harnessTabTitle(summary('codex'), { block: null, editable: true, active: null })).toBe('codex');
  });

  test('a blocked tab states the block, never the label', () => {
    const blocked = summary('pi', { canLaunch: false, unavailable: '`pi` is not installed', install: 'npm i -g pi-acp' });
    const title = harnessTabTitle(blocked, { block: { reason: '`pi` is not installed', fix: 'npm i -g pi-acp' }, editable: false, active: 'omp-rpc' });
    // The block comes FIRST: a tab can be both unusable and owned by another
    // agent, and only the block means anything about this harness.
    expect(title.startsWith('pi: `pi` is not installed')).toBe(true);
    expect(title).toContain('npm i -g pi-acp');
  });

  test('an agent that answered with a refusal is never told to install itself', () => {
    // Measured in the running picker: `codex` was blocked with "Authentication
    // required" and the tab appended `npm i -g @agentclientprotocol/codex-acp`
    // — telling the user to install a program that had just replied. A probe
    // refusal means the binary RAN, so only a missing launch gets install advice.
    const refused = summary('codex', {
      canLaunch: true,
      install: 'npm i -g @agentclientprotocol/codex-acp',
      probe: probeBlocked('Authentication required'),
    });
    const title = harnessTabTitle(refused, { block: harnessBlock(refused), editable: true, active: null });
    expect(title).toContain('Authentication required');
    expect(title).not.toContain('install');
  });

  test('a tab is the mark alone, so the mark carries the name', async () => {
    const el = await mount(h(HarnessTabs, {
      harnesses: [summary('codex')],
      active: 'codex',
      editable: true,
      onSelect: () => {},
    }));
    const tab = el.querySelector('[role="tab"]') as HTMLElement;
    // No visible label: the tab's textContent is empty, and the accessible name
    // is the harness's own label. Asserting only "the glyph is there" would pass
    // with a label beside it, which is the state this replaced.
    expect(tab.textContent?.trim()).toBe('');
    expect(tab.getAttribute('aria-label')).toBe('codex');
    expect(el.querySelector('[data-harness="codex"]')).not.toBeNull();
  });

  test('the tab mark is sized as a control, not as a row ornament', async () => {
    const el = await mount(h(HarnessTabs, {
      harnesses: [summary('codex')],
      active: 'codex',
      editable: true,
      onSelect: () => {},
    }));
    // The tab is the only control whose mark is the WHOLE target, so it is drawn
    // larger than the dense-list sizes it shares a component with.
    expect(el.querySelector('svg')?.getAttribute('width')).toBe(String(HARNESS_GLYPH_SIZE.tab));
    expect(HARNESS_GLYPH_SIZE.tab).toBeGreaterThan(HARNESS_GLYPH_SIZE.touch);
  });

  test('the mark inside a tab is DECORATION, so the tab keeps its own tooltip', async () => {
    // Measured: hovering a locked tab announced the glyph's generic "Session runs
    // on claude" and never the explanation — a nested `title` is the one the
    // browser shows, and it sits INSIDE the button.
    const el = await mount(h(HarnessTabs, {
      harnesses: [summary('omp-rpc', { label: 'omp' }), summary('claude')],
      active: 'omp-rpc',
      editable: false,
      onSelect: () => {},
    }));
    const claude = el.querySelectorAll('[role="tab"]')[1] as HTMLElement;
    const mark = claude.querySelector('[data-harness="claude"]') as HTMLElement;
    expect(mark.getAttribute('title')).toBeNull();
    expect(mark.getAttribute('role')).toBeNull();
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    // The reason, and the agent that owns the chat, live on the BUTTON.
    expect(claude.getAttribute('title')).toContain('already started on omp');
  });

  test('a tab that cannot switch shows the prohibition cursor', async () => {
    // Reported from use: a locked tab did nothing on press but showed no cursor
    // signal at all. The prohibition sign is the affordance that says "not here"
    // BEFORE the click; `cursor-help` was drawn as a QUESTION MARK on macOS and
    // read as a stray icon.
    const el = await mount(h(HarnessTabs, {
      harnesses: [
        summary('omp-rpc', { label: 'omp' }),
        summary('pi', { canLaunch: false, unavailable: 'not installed' }),
        summary('claude'),
      ],
      active: 'omp-rpc',
      editable: false,
      onSelect: () => {},
    }));
    const [owner, blocked, locked] = [...el.querySelectorAll('[role="tab"]')].map(
      (tab) => tab.className,
    );
    // The chat runs on omp, so every OTHER tab refuses the switch.
    expect(locked).toContain('cursor-not-allowed');
    // A blocked tab opens its settings page, so it still earns the pointer.
    expect(blocked).toContain('cursor-pointer');
    expect(blocked).not.toContain('cursor-not-allowed');
    // The current selection is not a refusal.
    expect(owner).toContain('cursor-default');
    expect(owner).not.toContain('cursor-not-allowed');
    for (const cls of [owner, blocked, locked]) expect(cls).not.toContain('cursor-help');
  });

  test('a selectable tab keeps the pointer, never the prohibition', async () => {
    const el = await mount(h(HarnessTabs, {
      harnesses: [summary('omp-rpc', { label: 'omp' }), summary('claude')],
      active: 'omp-rpc',
      editable: true,
      onSelect: () => {},
    }));
    for (const tab of el.querySelectorAll('[role="tab"]')) {
      expect(tab.className).toContain('cursor-pointer');
      expect(tab.className).not.toContain('cursor-not-allowed');
    }
  });

  test('a blocked tab is dimmed and keeps its name, since no word is left to mute', async () => {
    const el = await mount(h(HarnessTabs, {
      harnesses: [summary('pi', { canLaunch: false, unavailable: '`pi` is not installed' })],
      active: null,
      editable: true,
      onSelect: () => {},
    }));
    const tab = el.querySelector('[role="tab"]') as HTMLElement;
    expect(tab.getAttribute('aria-label')).toBe('pi');
    // Opacity, not a colour: the colour mode's brand hue outranks any `text-ink`
    // class on the mark, so a hue-only mute would look ready under `color`.
    expect(tab.querySelector('span[data-harness]')?.className).toContain('opacity-40');
    expect(tab.textContent).toContain('⚠');
  });

  test('no harnesses draws nothing rather than an empty strip', async () => {
    const el = await mount(h(HarnessTabs, { harnesses: [], active: null, editable: true, onSelect: () => {} }));
    expect(el.querySelector('[role="tablist"]')).toBeNull();
  });
});
