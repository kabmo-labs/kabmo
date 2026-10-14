/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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
let createCount = 0;

beforeAll(async () => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
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
  urlWithObjectUrls.createObjectURL = () => {
    const url = `blob:mock/${createCount++}`;
    created.push(url);
    return url;
  };
  urlWithObjectUrls.revokeObjectURL = (url: string) => {
    revoked.push(url);
  };
});

afterAll(() => {
  container.remove();
  restoreDomGlobals();
});

afterEach(() => {
  render(null, container);
  created.length = 0;
  revoked.length = 0;
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
    const state = mount({ id: '/api/fs/raw?path=x.pdf', url: '/api/fs/raw?path=x.pdf', loadBytes: null });
    await settle();
    expect(state.get().url).toBe('/api/fs/raw?path=x.pdf');
    expect(state.get().loading).toBe(false);
    expect(created).toHaveLength(0);
  });

  test('a handle-backed source wraps its bytes in an object URL', async () => {
    const state = mount({
      id: 'drop-1',
      url: null,
      loadBytes: async () => new ArrayBuffer(4),
    });
    await settle();
    expect(state.get().loading).toBe(false);
    expect(state.get().url).toBe('blob:mock/0');
    expect(created).toEqual(['blob:mock/0']);
  });

  test('a source with no bytes reports an error, not a blank frame', async () => {
    const state = mount({ id: 'inline-1', url: null, loadBytes: null });
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
    });
    await settle();
    expect(state.get().error).toBe('Could not read the file (HTTP 404).');
    expect(state.get().url).toBeNull();
  });

  test('the object URL is revoked when the source changes', async () => {
    const state = mount({ id: 'drop-a', url: null, loadBytes: async () => new ArrayBuffer(4) });
    await settle();
    expect(state.get().url).toBe('blob:mock/0');

    state.update({ id: 'drop-b', url: null, loadBytes: async () => new ArrayBuffer(8) }, 0);
    await settle();
    expect(state.get().url).toBe('blob:mock/1');
    // The first blob is released, or it leaks for the life of the page.
    expect(revoked).toContain('blob:mock/0');
  });
});
