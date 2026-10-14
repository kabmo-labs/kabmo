/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The stash section's disclosure contract.
 *
 * Three properties are invisible to a route test and each fails silently:
 *
 * - The body stays MOUNTED while collapsed, so the reveal has something to
 *   animate — and is then `inert`, or a hidden message field is tabbable and
 *   its controls are announced. A conditional render would pass every visual
 *   assertion and make the reveal a snap.
 * - The list is fetched ONLY when the section is opened. The status read is
 *   republished on every tool call, so a section that fetched on mount would
 *   run `git stash list` for every panel refresh nobody asked for.
 * - The open flag is per-session state (`git.stashExpanded`), so a session
 *   reopened with the section expanded comes back expanded — restored through
 *   the REAL store and provider, not by seeding a local.
 *
 * Rendered with `h()` against happy-dom, over a stubbed `fetch` that answers
 * both the session-state blob and the stash list.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { GitStashSection } from '@/client/components/workspace/git-panel/StashSection';
import { SessionStateProvider } from '@/client/components/common/session-state-provider/index';
import { forgetSession } from '@/shared/lib/workspace/session-state/store';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const SESSION = 'new-stash-section';

/** The runner's own fetch, reached through `Bun` so a leaked stub cannot be mistaken for it. */
const nativeFetch = Bun.fetch;

let container: HTMLElement;
/** Every `/api/fs/git` url this suite's stub answered. */
let stashReads: string[];
/** The actions the section handed up. */
let actions: Array<{ actionType: string; extra?: Record<string, string> }>;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
  forgetSession(SESSION);
  (globalThis as unknown as Record<string, unknown>).fetch = nativeFetch;
});

afterAll(() => {
  restoreDomGlobals();
});

/**
 * Mount the section, with the session-state blob the provider will read.
 *
 * `stored` is what the SESSION has persisted; leaving it out is a session that
 * never touched the section.
 */
async function mount(stored: Record<string, unknown> = {}): Promise<void> {
  stashReads = [];
  actions = [];
  const target = globalThis as unknown as Record<string, unknown>;
  target.fetch = async (input: unknown) => {
    const url = String(input);
    const json = (body: unknown) => new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    if (url.includes('/state')) return json({ sessionId: SESSION, state: stored });
    if (url.includes('/api/fs/git')) {
      stashReads.push(url);
      return json({
        stashes: [{ ref: 'stash@{0}', subject: 'wip', date: 'just now' }],
      });
    }
    return json({});
  };

  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(
      h(SessionStateProvider, {
        sessionId: SESSION,
        children: h(GitStashSection, {
          rootPath: '/ws',
          repo: '.',
          isBusy: false,
          onAction: (actionType: string, extra?: Record<string, string>) => {
            actions.push({ actionType, extra });
          },
        }),
      }),
      container,
    );
  });
  // The provider's blob load settles across a tick; the restore it drives is
  // what the expanded-by-default case depends on.
  for (let i = 0; i < 10; i += 1) await act(async () => {});
}

/** The reveal wrapper — the element whose grid track animates. */
function reveal(): HTMLElement {
  const el = container.querySelector('.section-reveal');
  if (!el) throw new Error('no .section-reveal wrapper rendered');
  return el as HTMLElement;
}

function toggle(): HTMLButtonElement {
  const el = container.querySelector('button[aria-controls]');
  if (!el) throw new Error('no stash toggle rendered');
  return el as HTMLButtonElement;
}

/** `Save` — the row's other button, a SIBLING of the toggle. */
function saveButton(): HTMLButtonElement {
  const el = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save');
  if (!el) throw new Error('no Save button rendered');
  return el as HTMLButtonElement;
}

/** The disclosure glyph — the same `▾`/`▸` the change list's sections use. */
function glyph(): string {
  const span = toggle().querySelector('span');
  return span?.textContent ?? '';
}

describe('GitStashSection disclosure', () => {
  test('collapsed by default: the body is mounted, inert, and nothing is fetched', async () => {
    await mount();

    expect(reveal().getAttribute('data-expanded')).toBe('false');
    expect(reveal().hasAttribute('inert')).toBe(true);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    // The collapsed glyph points RIGHT — the same mark the change list uses.
    expect(glyph()).toBe('▸');
    expect(stashReads).toEqual([]);
    // `Save` needs no list, so it stays usable while collapsed.
    expect(container.textContent).toContain('Save');
  });

  test('opening turns the glyph down, un-inerts the body and reads the list', async () => {
    await mount();

    await act(async () => {
      toggle().click();
    });
    for (let i = 0; i < 10; i += 1) await act(async () => {});

    expect(reveal().getAttribute('data-expanded')).toBe('true');
    expect(reveal().hasAttribute('inert')).toBe(false);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(glyph()).toBe('▾');
    expect(stashReads).toHaveLength(1);
    expect(stashReads[0]).toContain('stashes=1');
    expect(container.textContent).toContain('wip');
  });

  test('a session that left the section open restores it expanded', async () => {
    await mount({ 'git.stashExpanded': true });
    for (let i = 0; i < 10; i += 1) await act(async () => {});

    expect(reveal().getAttribute('data-expanded')).toBe('true');
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(stashReads).toHaveLength(1);
  });

  test('a row action is handed up with its ref, never dispatched locally', async () => {
    await mount({ 'git.stashExpanded': true });
    for (let i = 0; i < 10; i += 1) await act(async () => {});

    const drop = container.querySelector('button[aria-label="Drop stash"]');
    if (!drop) throw new Error('no Drop control rendered');
    await act(async () => {
      (drop as HTMLButtonElement).click();
    });

    expect(actions).toEqual([{ actionType: 'stash_drop', extra: { ref: 'stash@{0}' } }]);
  });
});

/**
 * The row IS the control.
 *
 * The toggle used to wrap the label alone, so a click in the empty span between
 * `Stash` and `Save` hit the row and did nothing — a 189px dead strip in a
 * 334px-wide panel (measured). These two cases pin the fix: the toggle covers
 * the row up to `Save`, and `Save` (a sibling inside the same row) does not
 * toggle as a side effect of stashing.
 */
describe('GitStashSection header row', () => {
  test('the toggle owns the row up to Save, and no further', async () => {
    await mount();

    const save = saveButton();
    const row = toggle().parentElement;
    expect(row).toBe(save.parentElement);
    // Both live in the row, so a click on either is a real click — and Save is
    // a sibling, never a child (a button inside a button is invalid and its
    // click would be swallowed).
    expect(toggle().contains(save)).toBe(false);
    expect(save.contains(toggle())).toBe(false);
  });

  test('the disclosure glyph is drawn in the change list\'s own face', async () => {
    await mount();

    // The glyph is a TEXT character, so its size is whatever face draws it:
    // the change list renders inside a `font-mono` container and its `▾` is
    // 4.65px of ink at 12px, while the app's sans stack draws the SAME
    // codepoint a quarter smaller (3.49px) — which read as "the icon is too
    // small". Asserting the class is the honest check here: the ink difference
    // is a font-metric fact a happy-dom `getComputedStyle` cannot compute.
    const span = toggle().querySelector('span');
    expect(span?.textContent).toBe('▸');
    expect(span?.getAttribute('class') ?? '').toContain('font-mono');
  });

  test('Save stashes without toggling the section', async () => {
    await mount();
    expect(glyph()).toBe('▸');

    await act(async () => {
      saveButton().click();
    });
    for (let i = 0; i < 5; i += 1) await act(async () => {});

    expect(actions).toEqual([{ actionType: 'stash_push', extra: {} }]);
    // The disclosure state is untouched: stashing is not operating the section.
    expect(glyph()).toBe('▸');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });
});
