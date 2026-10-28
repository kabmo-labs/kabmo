/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `useByteDocument` — loading a byte source once and parsing it.
 *
 * Every claim here is a way a viewer is silently wrong:
 *
 * - a source with no `loadBytes` (an inline attachment, a reloaded handle)
 *   reports an error rather than an empty pane, which would read as "this file
 *   is empty";
 * - a parser that throws surfaces the parser's OWN sentence, not a generic one;
 * - the effect keys on `source.id`/`revision` alone, so a re-render with a fresh
 *   `source` object and a fresh `parse` closure does not re-fetch or re-parse
 *   the document — the reason both are read through refs.
 *
 * The probe is ONE component whose props drive the inputs, re-rendered with the
 * same type: mounting a new component type instead would unmount the old one
 * and reset the hook state, proving nothing about the dependency list.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { ByteSource } from '@/client/components/workspace/editor/viewers/bytes';
import type { useByteDocument as UseByteDocument } from '@/client/components/workspace/editor/viewers/use-byte-document';

let useByteDocument: typeof UseByteDocument;
let container: HTMLElement;

beforeAll(async () => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  ({ useByteDocument } = await import('@/client/components/workspace/editor/viewers/use-byte-document'));
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterAll(() => {
  container.remove();
  restoreDomGlobals();
});

afterEach(() => {
  render(null, container);
});

/** Let a resolved promise chain settle inside `act`. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

interface Snapshot<T> {
  value: T | null;
  loading: boolean;
  error: string | null;
}

interface Harness<T> {
  get: () => Snapshot<T>;
  update: (next: { source: ByteSource; parse: (bytes: ArrayBuffer) => Promise<T>; revision: number }) => void;
}

/** Mount the hook, rendering each state into a captured slot. */
function mount<T>(source: ByteSource, parse: (bytes: ArrayBuffer) => Promise<T>, revision = 0): Harness<T> {
  let latest: Snapshot<T> = { value: null, loading: true, error: null };
  const probe = (props: { source: ByteSource; parse: (bytes: ArrayBuffer) => Promise<T>; revision: number }) => {
    latest = useByteDocument(props.source, props.parse, props.revision);
    return null;
  };
  act(() => {
    render(h(probe, { source, parse, revision }), container);
  });
  return {
    get: () => latest,
    // Re-render the SAME component type with new inputs.
    update: (next) => {
      act(() => {
        render(h(probe, next), container);
      });
    },
  };
}

function source(loadBytes: ByteSource['loadBytes'], id = 'src-1'): ByteSource {
  return { id, url: null, loadBytes, mimeType: null };
}

describe('useByteDocument', () => {
  test('a source with no bytes reports an error, not an empty pane', async () => {
    const state = mount(source(null), async () => 'x');
    await settle();
    expect(state.get().loading).toBe(false);
    expect(state.get().value).toBeNull();
    expect(state.get().error).toBe('This file cannot be read from here.');
  });

  test('the parsed value lands once the bytes arrive', async () => {
    const state = mount(source(async () => new ArrayBuffer(4)), async () => 'parsed');
    expect(state.get().loading).toBe(true);
    await settle();
    expect(state.get().value).toBe('parsed');
    expect(state.get().loading).toBe(false);
    expect(state.get().error).toBeNull();
  });

  test("a parser failure surfaces the parser's own sentence", async () => {
    const state = mount(
      source(async () => new ArrayBuffer(4)),
      async () => {
        throw new Error('Could not parse the workbook.');
      },
    );
    await settle();
    expect(state.get().error).toBe('Could not parse the workbook.');
    expect(state.get().value).toBeNull();
  });

  test('a non-Error rejection still produces a message', async () => {
    const state = mount(
      source(async () => new ArrayBuffer(4)),
      // eslint-disable-next-line prefer-promise-reject-errors
      () => Promise.reject('plain string'),
    );
    await settle();
    expect(state.get().error).toBe('Could not read this file.');
  });

  test('a re-render with fresh source/parse identities does not re-fetch', async () => {
    let loads = 0;
    const loadBytes = async () => {
      loads += 1;
      return new ArrayBuffer(4);
    };
    const state = mount(source(loadBytes), async () => 'v1');
    await settle();
    expect(loads).toBe(1);

    // New source OBJECT and new parse CLOSURE, same id and revision: neither may
    // trigger a reload.
    state.update({ source: source(loadBytes), parse: async () => 'v2', revision: 0 });
    await settle();
    expect(loads).toBe(1);
    expect(state.get().value).toBe('v1');
  });

  test('bumping the revision forces a re-read', async () => {
    let loads = 0;
    const loadBytes = async () => {
      loads += 1;
      return new ArrayBuffer(4);
    };
    const state = mount(source(loadBytes), async () => `v${loads}`, 0);
    await settle();
    expect(loads).toBe(1);
    expect(state.get().value).toBe('v1');

    state.update({ source: source(loadBytes), parse: async () => `v${loads}`, revision: 1 });
    await settle();
    expect(loads).toBe(2);
    expect(state.get().value).toBe('v2');
  });
});
