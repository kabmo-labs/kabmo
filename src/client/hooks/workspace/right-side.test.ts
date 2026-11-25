/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The right side's visibility — editor column, right panel and the rail beside
 * them — is ONE decision.
 *
 * The reported bug this pins: the navbar's toggle put away only the right
 * panel, so the activity rail stayed as a column of marks beside a collapsed
 * panel and the editor column kept its width. The cases below state what one
 * click does, what the next click does, and the two exceptions that keep the
 * rule honest: a side that is already half closed still collapses on the first
 * click, and a blank editor column is never forced open.
 *
 * Rendered with `h()` against happy-dom, like `panel-widths.test.ts`: the hook
 * reads session state, which needs no DOM, but the provider does.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { SessionStateContext } from '@/client/hooks/workspace/session-state/context';
import { useRightSideLayout, type RightSideLayout } from '@/client/hooks/workspace/right-side';
import { forgetSession } from '@/shared/lib/workspace/session-state/store';
import { readKabmoSetting } from '@/shared/lib/settings/client';
import { RIGHT_SIDE_HIDDEN_SETTING_KEY, saveRightSideHidden } from '@/shared/lib/workspace/right-side-hidden';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent'] as const;
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
const nativeFetch = Bun.fetch;

let container: HTMLElement;
const sessions: string[] = [];
let sessionCounter = 0;

/** The live hook value, re-read after every render. */
let side: RightSideLayout | null = null;
let options = { editorHasContent: true, editorOpensByDefault: true };

function SideProbe() {
  side = useRightSideLayout(options);
  return null;
}

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in native)) native[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  target.fetch = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (native[key] === undefined) delete target[key];
    else target[key] = native[key];
  }
  if (nativeFetch) target.fetch = nativeFetch;
  else delete target.fetch;
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  for (const id of sessions) forgetSession(id);
  sessions.length = 0;
  // The side's flag is GLOBAL now, so a test that put it away would otherwise
  // seed every test after it — resetting it is isolation, not the production
  // behaviour this suite pins below.
  saveRightSideHidden(false);
  side = null;
  options = { editorHasContent: true, editorOpensByDefault: true };
});

async function mount(overrides: Partial<typeof options> = {}): Promise<void> {
  options = { ...options, ...overrides };
  const sessionId = `right-side-${++sessionCounter}`;
  sessions.push(sessionId);
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(SessionStateContext.Provider, { value: { sessionId, ready: true }, children: h(SideProbe, {}) }), container);
  });
  await act(async () => {});
}

async function click(action: (current: RightSideLayout) => void): Promise<void> {
  await act(async () => {
    action(side as RightSideLayout);
  });
  await act(async () => {});
}

describe('the right side toggle', () => {
  test('one click puts the editor, the panel and the side away', async () => {
    await mount();
    expect(side!.hidden).toBe(false);
    expect(side!.showEditor).toBe(true);
    expect(side!.showRightPanel).toBe(true);

    await click((current) => current.toggleRightSide());

    // `hidden` is what the activity rail reads, and both columns read it too —
    // three columns, one flag.
    expect(side!.hidden).toBe(true);
    expect(side!.showEditor).toBe(false);
    expect(side!.showRightPanel).toBe(false);
  });

  test('putting the side away is global: the next session starts put away too', async () => {
    await mount();
    await click((current) => current.toggleRightSide());

    // The reported defect: the flag lived in `session_ui_state`, so a different
    // chat read the default and the side came back as if it had never closed.
    expect(side!.hidden).toBe(true);
    expect(readKabmoSetting<boolean>(RIGHT_SIDE_HIDDEN_SETTING_KEY)).toBe(true);

    await act(async () => {
      render(null, container);
    });
    container.remove();
    await mount();
    expect(side!.hidden).toBe(true);
    expect(side!.showRightPanel).toBe(false);
    expect(side!.showEditor).toBe(false);

    // The other direction is global for the same reason: opening it once is
    // the reader's screen from then on, whichever session is on it.
    await click((current) => current.toggleRightSide());
    expect(side!.hidden).toBe(false);
    await act(async () => {
      render(null, container);
    });
    container.remove();
    await mount();
    expect(side!.hidden).toBe(false);
  });

  test('the next click brings everything back, including a panel closed separately', async () => {
    await mount();
    // The reader closed the panel with its own wing control first, so a
    // "bring it back as it was" rule would leave the panel shut.
    await click((current) => current.closeRightPanel());
    expect(side!.showRightPanel).toBe(false);
    expect(side!.showEditor).toBe(true);

    await click((current) => current.toggleRightSide());
    expect(side!.hidden).toBe(true);

    await click((current) => current.toggleRightSide());
    expect(side!.hidden).toBe(false);
    expect(side!.showRightPanel).toBe(true);
    expect(side!.showEditor).toBe(true);
  });

  test('a half-closed side still collapses on the first click', async () => {
    await mount();
    await click((current) => current.closeRightPanel());
    expect(side!.showRightPanel).toBe(false);

    // The button's promise is about what is ON SCREEN, not about one flag: the
    // editor column and the rail are still there, so this click hides them.
    await click((current) => current.toggleRightSide());
    expect(side!.hidden).toBe(true);
    expect(side!.showEditor).toBe(false);
  });

  test('a side with both columns closed shows them rather than hiding nothing', async () => {
    await mount();
    await click((current) => current.closeRightPanel());
    await click((current) => current.toggleEditor());
    expect(side!.showRightPanel).toBe(false);
    expect(side!.showEditor).toBe(false);

    await click((current) => current.toggleRightSide());
    expect(side!.hidden).toBe(false);
    expect(side!.showRightPanel).toBe(true);
    expect(side!.showEditor).toBe(true);
  });

  test('a blank editor column is never forced open', async () => {
    await mount({ editorHasContent: false, editorOpensByDefault: false });
    expect(side!.showEditor).toBe(false);

    await click((current) => current.toggleRightSide());
    await click((current) => current.toggleRightSide());

    expect(side!.showEditor).toBe(false);
    expect(side!.showRightPanel).toBe(true);
  });
});

describe('the directions that must reveal the side', () => {
  test('opening the panel reveals a side that was put away', async () => {
    await mount();
    await click((current) => current.toggleRightSide());
    expect(side!.hidden).toBe(true);

    // A plugin's readout, a rail row, a file opened from the sidebar: each
    // writes a flag the layout must not ignore.
    await click((current) => current.revealRightPanel());
    expect(side!.hidden).toBe(false);
    expect(side!.showRightPanel).toBe(true);
  });

  test('asking for the editor reveals the side, so the chord is never dead', async () => {
    await mount();
    await click((current) => current.toggleRightSide());
    expect(side!.hidden).toBe(true);

    await click((current) => current.toggleEditor());
    expect(side!.hidden).toBe(false);
    expect(side!.showEditor).toBe(true);
  });

  test('the editor chord closes the column but leaves the rest of the side', async () => {
    await mount();
    await click((current) => current.toggleEditor());

    expect(side!.showEditor).toBe(false);
    expect(side!.showRightPanel).toBe(true);
    expect(side!.hidden).toBe(false);
  });

  test('hiding the editor is the corner switch: the side stays', async () => {
    await mount();
    await click((current) => current.hideEditor());

    expect(side!.showEditor).toBe(false);
    expect(side!.showRightPanel).toBe(true);
    expect(side!.hidden).toBe(false);
  });
});
