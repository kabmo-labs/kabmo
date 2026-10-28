/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The blame card's six states, and what each one SAYS.
 *
 * The sentences are the product here: a card that renders the right shape with
 * the wrong words still passes a DOM assertion, and the wrong words are exactly
 * what the first cut of this feature produced — "Blame failed" over a file that
 * was merely untracked, and a blank author line for a line that is not
 * committed yet.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { BlamePayload } from '@/shared/lib/fs/git-blame';
import type { BlameSnapshot, BlameHistoryResult, FileBlame } from '@/client/hooks/editor/blame';
import { blamePanelNote, createBlamePanel } from '@/client/components/common/code-surface/blame-panel';

const SHA = 'a'.repeat(40);
const OLD = 'b'.repeat(40);

const PAYLOAD: BlamePayload = {
  available: true,
  head: SHA,
  lines: 12,
  runs: [
    { from: 1, to: 3, sha: OLD },
    { from: 4, to: 12, sha: SHA },
  ],
  commits: {
    [SHA]: { sha: SHA, author: 'Ada Lovelace', mail: 'ada@example.com', time: 1_700_000_000, summary: 'feat: open the file' },
    [OLD]: { sha: OLD, author: 'Grace Hopper', mail: 'grace@example.com', time: 1_690_000_000, summary: 'fix: the bug' },
  },
};

/** A controller whose answer the test sets, and whose history it can hold open. */
function fakeController(snapshot: BlameSnapshot, options: { stale?: boolean; history?: BlameHistoryResult } = {}): FileBlame & {
  readonly reloads: number;
} {
  const listeners = new Set<() => void>();
  const state = { reloads: 0 };
  const controller: FileBlame & { readonly reloads: number } = {
    ensure: () => {},
    reload: () => {
      state.reloads += 1;
      for (const listener of listeners) listener();
    },
    history: async () => options.history ?? { entries: [], truncated: false },
    snapshot: () => snapshot,
    stale: () => options.stale === true,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get reloads() {
      return state.reloads;
    },
  };
  return controller;
}

/** The four fields `place` reads, as the DOM's own rect type. */
function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height } as DOMRect;
}

function text(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterAll(() => {
  restoreDomGlobals();
});

let body: HTMLElement;
beforeEach(() => {
  body = document.createElement('div');
  document.body.append(body);
});

describe('blamePanelNote', () => {
  const base = { line: 5, stale: false, history: null, historyOpen: false, historyLoading: false };

  test('an error is the only state that names a failure', () => {
    const note = blamePanelNote({
      ...base,
      status: 'error',
      payload: null,
      message: 'fatal: bad object',
    });
    expect(note).toEqual({ title: 'Blame failed', body: 'fatal: bad object' });
  });

  test('an untracked file is an answer, and does not claim a failure', () => {
    const note = blamePanelNote({
      ...base,
      status: 'unavailable',
      payload: { available: false, head: null, lines: 0, runs: [], commits: {}, reason: 'untracked' },
      message: "fatal: no such path 'x' in HEAD",
    });
    expect(note?.title).toBe('Not tracked');
    expect(note?.body).toContain('never been committed');
    expect(note?.title).not.toContain('failed');
  });

  test('a folder that is not a repository says which reason', () => {
    const note = blamePanelNote({
      ...base,
      status: 'unavailable',
      payload: { available: false, head: null, lines: 0, runs: [], commits: {}, reason: 'not-repo' },
      message: null,
    });
    expect(note?.title).toBe('No history');
    expect(note?.body).toContain('not a git repository');
  });

  test('a dirty buffer explains the edit rather than the file', () => {
    const note = blamePanelNote({ ...base, status: 'ready', payload: PAYLOAD, message: null, stale: true });
    expect(note?.title).toBe('Not committed yet');
    expect(note?.body).toContain('changed in the editor');
  });

  test('a line past the end of HEAD names the file’s own length', () => {
    const note = blamePanelNote({ ...base, line: 99, status: 'ready', payload: PAYLOAD, message: null });
    expect(note?.body).toContain('Line 99');
    expect(note?.body).toContain('12 lines');
  });

  test('a line the payload cannot place says so instead of drawing blanks', () => {
    const note = blamePanelNote({ ...base, line: 6, status: 'ready', payload: { ...PAYLOAD, runs: [] }, message: null });
    expect(note?.title).toBe('Not committed yet');
    expect(note?.body).toContain('no attribution for line 6');
  });

  test('a line whose commit is the all-zero sha is not attributed to a person', () => {
    const uncommitted = '0'.repeat(40);
    const note = blamePanelNote({
      ...base,
      status: 'ready',
      message: null,
      payload: {
        ...PAYLOAD,
        runs: [{ from: 5, to: 5, sha: uncommitted }],
        commits: { [uncommitted]: { sha: uncommitted, author: 'Not Committed Yet', mail: '', time: 0, summary: '' } },
      },
    });
    expect(note?.title).toBe('Not committed yet');
    expect(note?.body).toBe('This line differs from the last commit.');
  });

  test('an attributable line has no note at all', () => {
    expect(blamePanelNote({ ...base, status: 'ready', payload: PAYLOAD, message: null })).toBeNull();
  });
});

describe('createBlamePanel', () => {
  test('draws the author, the subject, the sha and the date', () => {
    const controller = fakeController({ status: 'ready', payload: PAYLOAD, message: null });
    const panel = createBlamePanel(5, controller, () => {});
    body.append(panel.element);

    const content = text(panel.element);
    expect(content).toContain('Ada Lovelace');
    expect(content).toContain('feat: open the file');
    expect(content).toContain(SHA.slice(0, 7));
    expect(content).toContain('Line history');
    // The card is a dialog to a screen reader, and it is named.
    expect(panel.element.getAttribute('role')).toBe('dialog');
    expect(panel.element.getAttribute('aria-label')).toBe('Line blame');
    panel.destroy();
  });

  test('the history toggle loads once and marks the oldest entry as the birth', async () => {
    const history: BlameHistoryResult = {
      entries: [
        { sha: SHA, author: 'Ada Lovelace', time: 1_700_000_000, summary: 'feat: x' },
        { sha: OLD, author: 'Grace Hopper', time: 1_690_000_000, summary: 'fix: y' },
      ],
      truncated: false,
    };
    const controller = fakeController({ status: 'ready', payload: PAYLOAD, message: null }, { history });
    const panel = createBlamePanel(5, controller, () => {});
    body.append(panel.element);

    expect(text(panel.element)).not.toContain('Grace Hopper');
    panel.element.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click();
    // The read is async; one microtask turn settles the stubbed promise.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const rows = panel.element.querySelectorAll('ol li');
    expect(rows).toHaveLength(2);
    expect(text(rows[0])).toContain('edit');
    expect(text(rows[1])).toContain('new');
    expect(panel.element.querySelector('button[aria-expanded]')!.getAttribute('aria-expanded')).toBe('true');
    panel.destroy();
  });

  test('a truncated history says the rest is not shown', async () => {
    const controller = fakeController(
      { status: 'ready', payload: PAYLOAD, message: null },
      { history: { entries: [{ sha: SHA, author: 'Ada', time: 1_700_000_000, summary: 'x' }], truncated: true } },
    );
    const panel = createBlamePanel(5, controller, () => {});
    body.append(panel.element);
    panel.element.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(text(panel.element)).toContain('Older commits are not shown.');
    panel.destroy();
  });

  test('an empty history is a sentence, not an empty box', async () => {
    const controller = fakeController({ status: 'ready', payload: PAYLOAD, message: null });
    const panel = createBlamePanel(5, controller, () => {});
    body.append(panel.element);
    panel.element.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(text(panel.element)).toContain('No commits touched this line.');
    panel.destroy();
  });

  test('the error state offers Try again, which asks its owner to re-read', () => {
    const controller = fakeController({ status: 'error', payload: null, message: 'fatal: bad object' });
    let retries = 0;
    const panel = createBlamePanel(5, controller, () => {
      retries += 1;
    });
    body.append(panel.element);

    expect(text(panel.element)).toContain('Blame failed');
    expect(text(panel.element)).toContain('fatal: bad object');
    panel.element.querySelector<HTMLButtonElement>('[aria-label="Read the blame again"]')!.click();
    // The CARD never reloads itself: it reports the press, and the surface that
    // owns the controller decides what a retry means.
    expect(retries).toBe(1);
    expect(controller.reloads).toBe(0);
    panel.destroy();
  });

  test('a loading card says it is reading rather than showing a blank', () => {
    const controller = fakeController({ status: 'loading', payload: null, message: null });
    const panel = createBlamePanel(5, controller, () => {});
    body.append(panel.element);
    // The beat between a hover and the file's blame landing: the card is on
    // screen with nothing to say yet, and an empty box reads as broken.
    expect(text(panel.element)).toBe('Reading blame…');
    panel.destroy();
  });

  test('place() keeps the card inside the viewport and flips it above near the bottom', () => {
    const controller = fakeController({ status: 'ready', payload: PAYLOAD, message: null });
    const panel = createBlamePanel(5, controller, () => {});
    body.append(panel.element);

    // happy-dom reports 0 for every box, so the card's own fallback size is what
    // decides the placement — which is the path a hidden pane takes.
    panel.place(rect(10, 10, 40, 16));
    expect(panel.element.style.left).toBe('10px');
    expect(panel.element.style.top).toBe('32px');

    // Past the bottom edge it flips above the anchor instead of being clipped.
    panel.place(rect(10, window.innerHeight - 10, 40, 16));
    expect(Number.parseFloat(panel.element.style.top)).toBeLessThan(window.innerHeight - 10);
    panel.destroy();
  });

  test('a press inside the card does not reach the document', () => {
    const controller = fakeController({ status: 'ready', payload: PAYLOAD, message: null });
    const panel = createBlamePanel(5, controller, () => {});
    body.append(panel.element);

    let reached = false;
    document.addEventListener('mousedown', () => {
      reached = true;
    });
    panel.element.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
    expect(reached).toBe(false);
    panel.destroy();
  });

  test('destroy unsubscribes, so a later change cannot repaint a removed card', () => {
    const controller = fakeController({ status: 'ready', payload: PAYLOAD, message: null });
    const panel = createBlamePanel(5, controller, () => {});
    body.append(panel.element);
    panel.destroy();
    expect(panel.element.isConnected).toBe(false);
    // A reload after destroy must not throw on a detached element.
    controller.reload();
  });
});
