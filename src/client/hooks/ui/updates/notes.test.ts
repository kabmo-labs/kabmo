/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `useActiveReleaseNotes` — the About modal's per-target "What's new" read.
 *
 * The contract that matters: the only thing sent is WHICH product (both
 * versions are derived server-side), the payload's own `error` field is what the
 * dialog shows, and a closed dialog makes no request at all. Stubbed `fetch`
 * records the URL, so a target mix-up cannot pass as a rendering detail.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { useActiveReleaseNotes } from '@/client/hooks/ui/updates/notes';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { ActiveReleaseNotes, UpdateTarget } from '@/shared/types/updates';

let container: HTMLElement;
const originalFetch = Bun.fetch;

/** The runner's own globals are restored in `afterAll`; `fetch` is not a DOM global. */
function Harness({ target }: { target: UpdateTarget | null }) {
  const notes = useActiveReleaseNotes(target);
  return h(
    'span',
    { id: 'out' },
    JSON.stringify({
      version: notes.data?.version ?? null,
      note: notes.data?.note?.version ?? null,
      loading: notes.loading,
      error: notes.error,
    }),
  );
}

function payload(overrides: Partial<ActiveReleaseNotes> = {}): ActiveReleaseNotes {
  return {
    target: 'kabmo',
    version: '3.9.0',
    note: { version: '3.9.0', date: '2026-01-01', url: 'https://example.test/v3.9.0', body: '* notes' },
    changelogUrl: 'https://example.test/CHANGELOG.md',
    error: null,
    ...overrides,
  };
}

/** A fetch double that records the URLs asked and answers one payload. */
function stubFetch(asked: string[], body: unknown, status = 200): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    asked.push(String(input));
    return { ok: status < 400, status, json: async () => body } as Response;
  }) as unknown as typeof fetch;
}

async function mount(target: UpdateTarget | null): Promise<Record<string, unknown>> {
  await act(async () => {
    render(h(Harness, { target }), container);
  });
  // The read is an effect: let its promise settle and re-render.
  for (let i = 0; i < 20; i += 1) await act(async () => {});
  return JSON.parse(container.querySelector('#out')?.textContent ?? '{}') as Record<string, unknown>;
}

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => render(null, container));
  globalThis.fetch = originalFetch;
});

afterAll(() => {
  container.remove();
  restoreDomGlobals();
  globalThis.fetch = originalFetch;
});

describe('useActiveReleaseNotes', () => {
  test('asks for the target and reports the section for the running version', async () => {
    const asked: string[] = [];
    stubFetch(asked, payload());

    const out = await mount('kabmo');

    expect(asked).toEqual(['/api/updates/notes?target=kabmo']);
    expect(out).toMatchObject({ version: '3.9.0', note: '3.9.0', loading: false, error: null });
  });

  test('the per-target URL is the product, never a caller-supplied version', async () => {
    const asked: string[] = [];
    stubFetch(asked, payload({ target: 'omp', version: '18.3.0' }));

    await mount('omp');

    expect(asked).toEqual(['/api/updates/notes?target=omp']);
  });

  test('a payload error is what the dialog shows', async () => {
    stubFetch([], payload({ version: '9.9.9', note: null, error: 'No changelog section for v9.9.9' }));

    const out = await mount('omp');

    expect(out).toMatchObject({
      version: '9.9.9',
      note: null,
      loading: false,
      error: 'No changelog section for v9.9.9',
    });
  });

  test('a non-ok response is reported instead of rendering nothing', async () => {
    stubFetch([], { error: 'Unknown update target' }, 400);

    const out = await mount('kabmo');

    expect(out.error).toBe('Could not load release notes (HTTP 400)');
    expect(out.loading).toBe(false);
  });

  test('a closed dialog makes no request', async () => {
    const asked: string[] = [];
    stubFetch(asked, payload());

    const out = await mount(null);

    expect(asked).toEqual([]);
    expect(out).toMatchObject({ version: null, note: null, loading: false, error: null });
  });
});