/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The priming contract, which is a TIMING contract.
 *
 * A dropped `File` may only be read from a read begun while the drop handler is
 * still running; a read started afterwards fails with `NotReadableError` and
 * keeps failing. These tests pin the two halves of that: `primeFileReads`
 * issues its read synchronously, and the read pipeline consumes the primed
 * result instead of starting a second, unauthorized one.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { primeFileReads, readFileTextWithRetry } from '@/client/hooks/chat/composer/file-reads';

/** A `FileReader` that answers from a lookup, counting the reads it was asked for. */
function installFakeReader(
  contents: Map<string, string>,
  options: { failDataUrl?: boolean; unreadable?: Set<File> } = {},
) {
  const calls: string[] = [];
  /** A file the browser refuses to read, whatever its metadata says. */
  const dead = (file: File) => options.unreadable?.has(file) ?? false;
  class FakeReader {
    result: string | ArrayBuffer | null = null;
    error: { name: string; message: string } | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;

    readAsArrayBuffer() {
      calls.push('arrayBuffer');
      queueMicrotask(() => {
        if (options.failDataUrl) {
          this.error = { name: 'NotReadableError', message: 'unreadable' };
          this.onerror?.();
          return;
        }
        this.result = new Uint8Array([1, 2, 3]).buffer;
        this.onload?.();
      });
    }

    readAsDataURL(file: File) {
      calls.push(`dataURL:${file.name}`);
      const body = dead(file) ? undefined : contents.get(file.name);
      queueMicrotask(() => {
        if (options.failDataUrl || body === undefined) {
          this.error = {
            name: 'NotReadableError',
            message: 'permission problems that have occurred after a reference to a file was acquired',
          };
          this.onerror?.();
          return;
        }
        // `data:<mime>;base64,<payload>` — the real reader's shape.
        const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(body)));
        this.result = `data:text/plain;base64,${base64}`;
        this.onload?.();
      });
    }

    readAsText(file: File) {
      calls.push(`text:${file.name}`);
      const body = dead(file) ? undefined : contents.get(file.name);
      queueMicrotask(() => {
        if (body === undefined) {
          this.error = { name: 'NotReadableError', message: 'unreadable' };
          this.onerror?.();
          return;
        }
        this.result = body;
        this.onload?.();
      });
    }
  }
  (globalThis as unknown as { FileReader: unknown }).FileReader = FakeReader;
  return calls;
}

const originalFileReader = (globalThis as unknown as { FileReader: unknown }).FileReader;

afterEach(() => {
  (globalThis as unknown as { FileReader: unknown }).FileReader = originalFileReader;
});

describe('primeFileReads', () => {
  test('starts the read synchronously, in the caller\'s own tick', () => {
    const calls = installFakeReader(new Map([['a.md', 'body']]));
    const file = new File(['body'], 'a.md', { type: 'text/markdown' });

    primeFileReads([file]);

    // The point of the module: the calls are already made when this returns. A
    // read deferred to a microtask would be outside the drop handler's tick and
    // therefore unauthorized.
    expect(calls.filter((c) => c.startsWith('dataURL:'))).toEqual(['dataURL:a.md']);
    expect(calls.filter((c) => c === 'arrayBuffer').length).toBe(1);
  });

  test('reads each file once however many batches carry it', () => {
    const calls = installFakeReader(new Map([['a.md', 'body']]));
    const file = new File(['body'], 'a.md', { type: 'text/markdown' });

    primeFileReads([file, file]);

    expect(calls.filter((c) => c.startsWith('dataURL:'))).toEqual(['dataURL:a.md']);
  });

  test('stays inside the attach cap, so an oversized drop is not read whole', () => {
    const calls = installFakeReader(new Map());
    const files = Array.from({ length: 80 }, (_, i) => new File(['x'], `f${i}.txt`));

    primeFileReads(files);

    expect(calls.filter((c) => c.startsWith('dataURL:')).length).toBeLessThanOrEqual(50);
  });
});

describe('a drop that exposes one file as two objects', () => {
  // A drop can hand over the same file twice — once in `files`, once in the item
  // list — and only one of the two objects actually reads. Which one is not
  // knowable up front: the same drop read fine in a browser tab and failed in an
  // installed app window, with the unreadable object still reporting the right
  // name and size. So the read path tries the counterpart instead of trusting
  // the choice.
  test('falls back to the counterpart object when the primary will not read', async () => {
    const primary = new File(['x'.repeat(40)], 'notes.md', { type: 'text/markdown' });
    const counterpart = new File(['rescued body'], 'notes.md', { type: 'text/markdown' });
    // The primary refuses to read while declaring bytes; the counterpart reads.
    const calls = installFakeReader(
      new Map([['notes.md', 'rescued body']]),
      { unreadable: new Set([primary]) },
    );
    const primed = primeFileReads([primary], new Map([[primary, counterpart]]));

    const content = await readFileTextWithRetry(primary, primed);

    expect(content).toBe('rescued body');
    expect(calls.filter((c) => c.startsWith('dataURL:')).length).toBe(2);

    // Not vacuous: with no counterpart primed the same file stays unreadable,
    // which is exactly the failure this pairing exists to prevent.
    const alone = primeFileReads([primary]);
    expect(await readFileTextWithRetry(primary, alone)).toBeNull();
  });

  test('the counterpart is primed in the same tick, not read on demand', () => {
    const primary = new File(['x'], 'a.md', { type: 'text/markdown' });
    const counterpart = new File(['y'], 'a.md', { type: 'text/markdown' });
    const calls = installFakeReader(new Map());

    primeFileReads([primary], new Map([[primary, counterpart]]));

    // Both reads must already be in flight when the call returns: one started
    // later would be outside the drop's permission window.
    expect(calls.filter((c) => c.startsWith('dataURL:')).length).toBe(2);
  });
});

describe('readFileTextWithRetry with a primed read', () => {
  test('returns the primed body without starting another read', async () => {
    const calls = installFakeReader(new Map([['a.md', 'primed body']]));
    const file = new File(['primed body'], 'a.md', { type: 'text/markdown' });
    const primed = primeFileReads([file]);

    const content = await readFileTextWithRetry(file, primed);

    expect(content).toBe('primed body');
    // Exactly one read: a second would be the unauthorized one, and its failure
    // would be indistinguishable from an unreadable file.
    expect(calls.filter((c) => c.startsWith('dataURL:'))).toEqual(['dataURL:a.md']);
  });

  test('falls back to its own reads when the file was never primed', async () => {
    const calls = installFakeReader(new Map([['b.md', 'late body']]));
    const file = new File(['late body'], 'b.md', { type: 'text/markdown' });

    const content = await readFileTextWithRetry(file);

    expect(content).toBe('late body');
    expect(calls.length).toBeGreaterThan(0);
  });

  test('retries a primed read that came back empty, for a promised file', async () => {
    // The primed read lands before the bytes do; the retry loop is what covers
    // that, so it must not be short-circuited by the primed attempt.
    const calls = installFakeReader(new Map());
    const file = new File(['x'.repeat(100)], 'promised.md', { type: 'text/markdown' });
    const primed = primeFileReads([file]);

    const content = await readFileTextWithRetry(file, primed);

    // Null, not '': the file DECLARES bytes, so an empty body is a failure the
    // caller reports rather than a genuinely empty file it accepts.
    expect(content).toBeNull();
    expect(calls.filter((c) => c === 'text:promised.md').length).toBeGreaterThan(1);
  });

  test('accepts an empty body for a file that declares no bytes', async () => {
    // A genuinely empty file is empty forever; retrying it cannot change that,
    // so it settles as empty rather than as a failure.
    installFakeReader(new Map());
    const file = new File([], 'empty.md', { type: 'text/markdown' });

    expect(await readFileTextWithRetry(file, primeFileReads([file]))).toBe('');
  });
});
