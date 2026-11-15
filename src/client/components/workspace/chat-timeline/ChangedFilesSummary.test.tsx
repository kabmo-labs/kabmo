/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The run's changed-files summary.
 *
 * Two facts are pinned here because both were visible defects waiting to
 * happen:
 *
 *  - the frame sits on the transcript gutter. Desktop keeps `mx-3` so the box
 *    lines up with the tool cards above it; a phone has no gutter, because its
 *    container already is one (see `transcriptGutter`).
 *  - the `+`/`−` counts the server returns are printed per file and summed in
 *    the header. A path with no counts (an unstored blob) prints none, never a
 *    zero that claims the write changed nothing.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ChangedFilesSummary } from '@/client/components/workspace/chat-timeline/ChangedFilesSummary';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { ChangedFile } from '@/shared/types';

const originalFetch = Bun.fetch;
let container: HTMLElement;

const FILES: ChangedFile[] = [
  { path: '/repo/src/a.ts', displayPath: 'src/a.ts', status: 'modified', agent: 'Main' },
  { path: '/repo/src/b.ts', displayPath: 'src/b.ts', status: 'added', agent: 'Main' },
];

beforeAll(() => installDomGlobals(new Window({ url: 'http://localhost' })));
afterAll(() => restoreDomGlobals());

beforeEach(() => {
  globalThis.fetch = (async () => Response.json({
    files: {
      '/repo/src/a.ts': { added: 3, removed: 1 },
      '/repo/src/b.ts': { added: 4, removed: 0 },
    },
  })) as unknown as typeof fetch;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  render(null, container);
  container.remove();
});

async function paint(files: ChangedFile[], isMobile: boolean): Promise<HTMLElement> {
  await act(async () => {
    render(
      h(ChangedFilesSummary, { files, sessionId: 's1', from: 1, to: 2, isMobile }),
      container,
    );
  });
  // The stats read resolves on a later task; let it land inside `act`.
  await act(async () => {
    const tick = Promise.withResolvers<void>();
    setTimeout(tick.resolve, 0);
    await tick.promise;
  });
  return container;
}

describe('ChangedFilesSummary', () => {
  test('desktop keeps the transcript gutter, a phone does not', async () => {
    const desktop = await paint(FILES, false);
    const desktopBox = desktop.firstElementChild as HTMLElement;
    expect(desktopBox.className).toContain('mx-3');

    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    const phone = await paint(FILES, true);
    const phoneBox = phone.firstElementChild as HTMLElement;
    expect(phoneBox.className).not.toContain('mx-3');
  });

  test('the header sums every file’s counts and each row prints its own', async () => {
    const el = await paint(FILES, false);
    const header = el.querySelector('button') as HTMLElement;
    expect(header.textContent).toContain('2 files changed');
    expect(header.textContent).toContain('+7');
    expect(header.textContent).toContain('\u22121');

    await act(async () => {
      header.click();
    });
    const rows = el.querySelectorAll('li');
    expect(rows.length).toBe(2);
    expect(rows[0]?.textContent).toContain('+3');
    expect(rows[0]?.textContent).toContain('\u22121');
    expect(rows[1]?.textContent).toContain('+4');
    expect(rows[1]?.textContent).not.toContain('\u22120');
  });

  test('a file the server could not count prints no stat', async () => {
    globalThis.fetch = (async () => Response.json({
      files: { '/repo/src/a.ts': { added: 2, removed: 0 } },
    })) as unknown as typeof fetch;

    const el = await paint(FILES, false);
    const header = el.querySelector('button') as HTMLElement;
    expect(header.textContent).toContain('+2');

    await act(async () => {
      header.click();
    });
    const rows = el.querySelectorAll('li');
    expect(rows[1]?.textContent).not.toContain('+');
    expect(rows[1]?.textContent).not.toContain('\u2212');
  });
});
