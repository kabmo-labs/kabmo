/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `useByteUrl` — a URL a browser can load bytes from.
 *
 * The claims are the ones that break a viewer visibly:
 *
 * - a source that already HAS a URL (`/api/fs/raw`) resolves synchronously, with
 *   no fetch and no loading flash;
 * - a handle-backed source with no URL reads its bytes and wraps them in an
 *   object URL;
 * - that object URL is REVOKED when the source changes, because an object URL
 *   holds its Blob alive until revoked and a long session that opened many
 *   dropped files would otherwise leak every one of them;
 * - a source with no bytes reports an error rather than an empty pane.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { ByteSource } from '@/client/components/workspace/editor/viewers/bytes';
import type { useByteUrl as UseByteUrl } from '@/client/components/workspace/editor/viewers/use-byte-url';

let useByteUrl: typeof UseByteUrl;
let container: HTMLElement;
const created: string[] = [];
const revoked: string[] = [];
/** The Blob each object URL was made from, so its MIME type is assertable. */
const createdBlobTypes: string[] = [];
/** Every URL the probe asked about, so the HEAD itself is assertable. */
const probed: string[] = [];
/** The response the probe gets: `ok` unless a test overrides it. */
let probeResponse: { ok: boolean; status: number; error?: string } = { ok: true, status: 200 };
let createCount = 0;
const nativeFetch = globalThis.fetch;

beforeAll(async () => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  // The probe is a real `fetch`, so it is stubbed: the claim under test is what
  // the hook does with a refusal, not whether the network works.
  globalThis.fetch = (async (url: string, init?: { method?: string }) => {
    probed.push(`${init?.method ?? 'GET'} ${url}`);
    return {
      ok: probeResponse.ok,
      status: probeResponse.status,
      json: async () => (probeResponse.error ? { error: probeResponse.error } : null),
    };
  }) as unknown as typeof globalThis.fetch;
  ({ useByteUrl } = await import('@/client/components/workspace/editor/viewers/use-byte-url'));
  container = document.createElement('div');
  document.body.appendChild(container);
  // Spy on the object-URL pair so "created then revoked" is observable. The
  // functions exist on happy-dom's URL; the cast is only to keep their
  // signatures, and it is a named const rather than an inline member cast.
  const urlWithObjectUrls = URL as typeof URL & {
    createObjectURL: (blob: Blob) => string;
    revokeObjectURL: (url: string) => void;
  };
  urlWithObjectUrls.createObjectURL = (blob: Blob) => {
    const url = `blob:mock/${createCount++}`;
    created.push(url);
    createdBlobTypes.push(blob.type);
    return url;
  };
  urlWithObjectUrls.revokeObjectURL = (url: string) => {
    revoked.push(url);
  };
});

afterAll(() => {
  container.remove();
  globalThis.fetch = nativeFetch;
  restoreDomGlobals();
});

afterEach(() => {
  render(null, container);
  created.length = 0;
  revoked.length = 0;
  createdBlobTypes.length = 0;
  probed.length = 0;
  probeResponse = { ok: true, status: 200 };
  createCount = 0;
});

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

interface UrlState {
  url: string | null;
  loading: boolean;
  error: string | null;
}

function mount(source: ByteSource, revision = 0): { get: () => UrlState; update: (s: ByteSource, r: number) => void } {
  let latest: UrlState = { url: null, loading: true, error: null };
  const probe = (props: { source: ByteSource; revision: number }) => {
    latest = useByteUrl(props.source, props.revision);
    return null;
  };
  act(() => {
    render(h(probe, { source, revision }), container);
  });
  return {
    get: () => latest,
    update: (s, r) => {
      act(() => {
        render(h(probe, { source: s, revision: r }), container);
      });
    },
  };
}

describe('useByteUrl', () => {
  test('a source that already has a URL resolves with no object URL', async () => {
    const state = mount({ id: '/api/fs/raw?path=x.pdf', url: '/api/fs/raw?path=x.pdf', loadBytes: null, mimeType: 'application/pdf' });
    await settle();
    expect(state.get().url).toBe('/api/fs/raw?path=x.pdf');
    expect(state.get().loading).toBe(false);
    expect(created).toHaveLength(0);
  });

  // `/api/fs/raw` answers a file past its ceiling with a 415 and a JSON body,
  // and an `<iframe>` pointed at that draws the raw JSON (or a blank frame)
  // rather than the refusal the user needs. The URL is therefore PROBED with a
  // one-byte ranged GET — not a HEAD, which carries no body and would replace
  // the server's own sentence with a generic "HTTP 415".
  test('a server URL is probed with a ranged GET before the frame uses it', async () => {
    const state = mount({ id: 'raw-1', url: '/api/fs/raw?path=x.pdf', loadBytes: null, mimeType: 'application/pdf' });
    await settle();

    expect(probed).toEqual(['GET /api/fs/raw?path=x.pdf']);
    expect(state.get().url).toBe('/api/fs/raw?path=x.pdf');
    expect(state.get().error).toBeNull();
  });

  test('a refusal from the raw route is reported instead of drawn', async () => {
    probeResponse = { ok: false, status: 415, error: 'This file is 45.00 MB — larger than the 30.00 MB the editor opens.' };
    const state = mount({ id: 'raw-2', url: '/api/fs/raw?path=huge.pdf', loadBytes: null, mimeType: 'application/pdf' });
    await settle();

    expect(state.get().url).toBeNull();
    expect(state.get().loading).toBe(false);
    expect(state.get().error).toBe('This file is 45.00 MB — larger than the 30.00 MB the editor opens.');
  });

  // A dropped request says nothing about the file, so it must not be reported as
  // a refusal — the frame gets the URL and the failure surfaces where it means
  // something (the plugin's own error, or an empty document).
  test('a probe that cannot be answered still uses the URL', async () => {
    globalThis.fetch = (async () => {
      throw new Error('network down');
    }) as unknown as typeof globalThis.fetch;
    const state = mount({ id: 'raw-3', url: '/api/fs/raw?path=x.pdf', loadBytes: null, mimeType: 'application/pdf' });
    await settle();

    expect(state.get().url).toBe('/api/fs/raw?path=x.pdf');
    expect(state.get().error).toBeNull();
  });

  // A `blob:` URL is ours, made from bytes already in hand: nothing to probe.
  test('an object URL is used without a probe', async () => {
    const state = mount({ id: 'drop-blob', url: 'blob:http://localhost/abc', loadBytes: null, mimeType: 'application/pdf' });
    await settle();

    expect(probed).toEqual([]);
    expect(state.get().url).toBe('blob:http://localhost/abc');
  });

  test('a handle-backed source wraps its bytes in an object URL', async () => {
    const state = mount({
      id: 'drop-1',
      url: null,
      loadBytes: async () => new ArrayBuffer(4),
      mimeType: null,
    });
    await settle();
    expect(state.get().loading).toBe(false);
    expect(state.get().url).toBe('blob:mock/0');
    expect(created).toEqual(['blob:mock/0']);
  });

  // The Blob's type is the object URL's `Content-Type`, and Chrome's PDF plugin
  // reads that header to decide whether to initialize: an untyped Blob serves an
  // EMPTY one and the dropped PDF renders as a blank frame (measured — the typed
  // blob got the `chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai` viewer
  // frame and the untyped one got nothing). A workspace PDF is unaffected, since
  // its URL is `/api/fs/raw`, which already sets the header.
  test('a handle-backed document labels its object URL with the source MIME', async () => {
    const state = mount({
      id: 'drop-pdf',
      url: null,
      loadBytes: async () => new ArrayBuffer(4),
      mimeType: 'application/pdf',
    });
    await settle();

    expect(state.get().url).toBe('blob:mock/0');
    expect(createdBlobTypes).toEqual(['application/pdf']);
  });

  // A source with no MIME has nothing honest to label the Blob with, so it stays
  // untyped rather than guessing a type the viewer would then trust.
  test('a source with no MIME leaves the Blob untyped', async () => {
    const state = mount({
      id: 'drop-txt',
      url: null,
      loadBytes: async () => new ArrayBuffer(4),
      mimeType: null,
    });
    await settle();

    expect(state.get().url).toBe('blob:mock/0');
    expect(createdBlobTypes).toEqual(['']);
  });

  test('a source with no bytes reports an error, not a blank frame', async () => {
    const state = mount({ id: 'inline-1', url: null, loadBytes: null, mimeType: null });
    await settle();
    expect(state.get().url).toBeNull();
    expect(state.get().error).toBe('This file cannot be read from here.');
  });

  test('a failed read surfaces the message', async () => {
    const state = mount({
      id: 'drop-2',
      url: null,
      loadBytes: async () => {
        throw new Error('Could not read the file (HTTP 404).');
      },
      mimeType: null,
    });
    await settle();
    expect(state.get().error).toBe('Could not read the file (HTTP 404).');
    expect(state.get().url).toBeNull();
  });

  test('the object URL is revoked when the source changes', async () => {
    const state = mount({ id: 'drop-a', url: null, loadBytes: async () => new ArrayBuffer(4), mimeType: null });
    await settle();
    expect(state.get().url).toBe('blob:mock/0');

    state.update({ id: 'drop-b', url: null, loadBytes: async () => new ArrayBuffer(8), mimeType: null }, 0);
    await settle();
    expect(state.get().url).toBe('blob:mock/1');
    // The first blob is released, or it leaks for the life of the page.
    expect(revoked).toContain('blob:mock/0');
  });
});
