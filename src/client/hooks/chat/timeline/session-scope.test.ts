/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which chat is open and what the navbar calls it.
 *
 * The chat's scope lives in the query string, not in component state: the right
 * panel scopes to the same `folderId`, and a reload has to land on the same
 * chat. The rules pinned here are the ones both readers depend on — the picker
 * mirrors its choice back into the query string (and dropping the folder must
 * REMOVE the param rather than write an empty one, or the panel would scope to
 * a folder named ""), and a change made elsewhere in the URL moves the picker.
 *
 * The title rules are the other half of "which chat is this": a pending
 * `new-…` chat has no metadata yet, so it shows the timestamped default derived
 * from its own id. A rename event from the sidebar overrides the server's
 * title, but only for the session it names, and only until the user switches
 * chats — a rename is not a property of the app, so carrying it into the next
 * chat would mislabel it.
 *
 * The router's store is module-level and shared, so each case clears the params
 * it does not care about first; that is also what makes "the picker preserves
 * the session" a real assertion rather than a coincidence.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useTimelineScope } from '@/client/hooks/chat/timeline/scope';
import { useSessionTitle } from '@/client/hooks/chat/timeline/session-title';
import { formatNewSessionTitle } from '@/shared/lib/omp/session/default-title';
import { publishClientSignal } from '@/client/lib/signals';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent'] as const;
/** The runner's own globals, restored on teardown so later files still have them. */
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let container: HTMLElement;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in native)) native[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (native[key] === undefined) delete target[key];
    else target[key] = native[key];
  }
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

async function drain(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await act(async () => {});
}

describe('useTimelineScope', () => {
  function ScopeProbe() {
    const scope = useTimelineScope();
    const set = (key: string, value: string | null): void => {
      scope.setSearchParams((prev) => {
        if (value === null) prev.delete(key);
        else prev.set(key, value);
        return prev;
      }, { replace: true });
    };
    return h(
      'div',
      null,
      h('span', { id: 'session' }, scope.sessionId ?? 'none'),
      h('span', { id: 'folder' }, scope.folderId ?? 'none'),
      h('span', { id: 'selected' }, String(scope.selectedFolderId)),
      h('button', { id: 'clear', onClick: () => { set('sessionId', null); set('folderId', null); } }, 'clear'),
      // The span above already owns `#session`; two elements with one id make
      // `querySelector('#session')` hand back the span, so a click "on the
      // button" silently did nothing.
      h('button', { id: 'set-session', onClick: () => set('sessionId', 's1') }, 'session'),
      h('button', { id: 'folder3', onClick: () => set('folderId', '3') }, 'folder3'),
      h('button', { id: 'folder0', onClick: () => set('folderId', '0') }, 'folder0'),
      h('button', { id: 'pick7', onClick: () => scope.selectContextFolder(7) }, 'pick7'),
      h('button', { id: 'unpick', onClick: () => scope.selectContextFolder(null) }, 'unpick'),
    );
  }

  async function paint(): Promise<HTMLElement> {
    container ??= document.body.appendChild(document.createElement('div'));
    await act(async () => { render(h(ScopeProbe, {}), container as HTMLElement); });
    await drain();
    return container;
  }

  async function click(el: HTMLElement, id: string): Promise<void> {
    await act(async () => { (el.querySelector(`#${id}`) as HTMLButtonElement).click(); });
    await drain();
  }

  /** Every case starts from a URL with no chat scope at all. */
  async function fresh(): Promise<HTMLElement> {
    const el = await paint();
    await click(el, 'clear');
    return el;
  }

  test('an empty query string means no session and no folder pick', async () => {
    const el = await fresh();
    expect(el.querySelector('#session')?.textContent).toBe('none');
    expect(el.querySelector('#folder')?.textContent).toBe('none');
    expect(el.querySelector('#selected')?.textContent).toBe('null');
  });

  test('the session id is read from the query string', async () => {
    const el = await fresh();
    await click(el, 'set-session');
    expect(el.querySelector('#session')?.textContent).toBe('s1');
    expect(window.location.search).toContain('sessionId=s1');
  });

  test('the folder id is parsed into the picker selection', async () => {
    const el = await fresh();
    await click(el, 'folder3');
    expect(el.querySelector('#folder')?.textContent).toBe('3');
    expect(el.querySelector('#selected')?.textContent).toBe('3');
  });

  test('folder id 0 is a pick, not "no folder"', async () => {
    const el = await fresh();
    await click(el, 'folder0');
    expect(el.querySelector('#selected')?.textContent).toBe('0');
  });

  test('picking a folder mirrors it into the URL without dropping the session', async () => {
    const el = await fresh();
    await click(el, 'set-session');
    await click(el, 'pick7');
    expect(el.querySelector('#selected')?.textContent).toBe('7');
    expect(window.location.search).toContain('folderId=7');
    expect(window.location.search).toContain('sessionId=s1');
  });

  test('dropping the folder removes the param instead of writing an empty one', async () => {
    const el = await fresh();
    await click(el, 'set-session');
    await click(el, 'folder3');
    await click(el, 'unpick');
    expect(el.querySelector('#selected')?.textContent).toBe('null');
    expect(window.location.search).not.toContain('folderId');
    expect(window.location.search).toContain('sessionId=s1');
  });

  test('a folder change made outside the picker moves the picker', async () => {
    const el = await fresh();
    await click(el, 'folder3');
    await click(el, 'folder0');
    expect(el.querySelector('#folder')?.textContent).toBe('0');
    expect(el.querySelector('#selected')?.textContent).toBe('0');
  });
});

describe('useSessionTitle', () => {
  const titles: (string | null)[] = [];
  const record = (title: string | null): void => { titles.push(title); };

  function TitleProbe({ sessionId, serverTitle }: { sessionId: string | null; serverTitle: string | null }) {
    useSessionTitle(sessionId, serverTitle, record);
    return null;
  }

  function rename(sessionId: string, title: string): void {
    publishClientSignal('session-renamed', { sessionId, title });
  }

  async function paint(sessionId: string | null, serverTitle: string | null): Promise<void> {
    container ??= document.body.appendChild(document.createElement('div'));
    await act(async () => { render(h(TitleProbe, { sessionId, serverTitle }), container as HTMLElement); });
    await drain();
  }

  test('a pending chat shows its timestamped default, not the server title', async () => {
    titles.length = 0;
    await paint('new-1790756769131', 'Server');
    expect(titles.at(-1)).toBe(formatNewSessionTitle(new Date(1790756769131)));
  });

  test('a pending chat an hour later shows a different title', async () => {
    titles.length = 0;
    await paint('new-1790756769131', null);
    const first = titles.at(-1);
    await paint('new-1790756773131', null);
    expect(titles.at(-1)).toBe(formatNewSessionTitle(new Date(1790756773131)));
    expect(titles.at(-1)).not.toBe(first);
  });

  test('a real session falls back to the server title', async () => {
    titles.length = 0;
    await paint('s1', 'Server');
    expect(titles.at(-1)).toBe('Server');
  });

  test('a nameless real session reports null rather than an empty string', async () => {
    titles.length = 0;
    await paint('s1', null);
    expect(titles.at(-1)).toBeNull();
  });

  test('a rename event overrides the server title for that session', async () => {
    titles.length = 0;
    await paint('s1', 'Server');
    await act(async () => { rename('s1', 'Renamed'); });
    expect(titles.at(-1)).toBe('Renamed');
  });

  test('a rename for another session is ignored', async () => {
    titles.length = 0;
    await paint('s1', 'Server');
    await act(async () => { rename('s2', 'Other'); });
    expect(titles.at(-1)).toBe('Server');
  });

  test('a rename with no title is ignored', async () => {
    titles.length = 0;
    await paint('s1', 'Server');
    await act(async () => {
      publishClientSignal('session-renamed', { sessionId: 's1', title: '' });
    });
    expect(titles.at(-1)).toBe('Server');
  });

  test('switching chats drops the optimistic rename', async () => {
    titles.length = 0;
    await paint('s1', 'Server');
    await act(async () => { rename('s1', 'Renamed'); });
    expect(titles.at(-1)).toBe('Renamed');
    await paint('s2', 'Second');
    expect(titles.at(-1)).toBe('Second');
  });
});
