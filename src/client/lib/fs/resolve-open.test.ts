/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Turning an absolute reference into a tab's scope, and the ONE retry a real
 * gesture earns.
 *
 * The rules under test are the ones that fail silently: a file inside a
 * workspace must not be granted (a grant is a lasting permission and the list is
 * bounded), a refusal that is not `outside_workspace` must not be retried, and a
 * file the editor cannot draw must be reported rather than opened.
 */

import { describe, expect, test } from 'bun:test';
import { resolveOpenableFile } from '@/client/lib/fs/resolve-open';

interface Call {
  url: string;
  method: string;
}

/** A stub `fetch` answering a scripted sequence, one response per call. */
function stubFetch(answers: { status: number; body: unknown }[]) {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET' });
    const next = answers.shift() ?? { status: 500, body: {} };
    return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.body };
  }) as unknown as typeof globalThis.fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

describe('resolveOpenableFile', () => {
  test('a file inside a workspace resolves through the scope route alone', async () => {
    const stub = stubFetch([
      { status: 200, body: { root: '/w', path: 'a/b.md', name: 'b.md', kind: 'text' } },
    ]);
    try {
      const result = await resolveOpenableFile('/w/a/b.md');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.file).toEqual({ root: '/w', path: 'a/b.md', name: 'b.md', kind: 'text' });
      // No grant: the file is already readable, and granting would evict a real
      // external root from the bounded list.
      expect(stub.calls.map((call) => call.method)).toEqual(['GET']);
    } finally {
      stub.restore();
    }
  });

  test('a file outside every workspace is granted, then resolved', async () => {
    const stub = stubFetch([
      { status: 403, body: { error: 'outside', code: 'outside_workspace' } },
      { status: 200, body: { root: '/Users/x/Desktop', path: 'r.pdf', name: 'r.pdf', kind: 'document' } },
    ]);
    try {
      const result = await resolveOpenableFile('/Users/x/Desktop/r.pdf');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.file.root).toBe('/Users/x/Desktop');
      expect(stub.calls.map((call) => call.method)).toEqual(['GET', 'POST']);
      expect(stub.calls[1].url).toBe('/api/fs/grant');
    } finally {
      stub.restore();
    }
  });

  test('any other refusal is final — no grant is attempted', async () => {
    const stub = stubFetch([
      { status: 404, body: { error: 'File not found' } },
      { status: 200, body: { root: '/w', path: 'x', name: 'x' } },
    ]);
    try {
      const result = await resolveOpenableFile('/w/x');
      expect(result).toEqual({ ok: false, message: 'File not found' });
      expect(stub.calls.length).toBe(1);
    } finally {
      stub.restore();
    }
  });

  test('a binary or oversized file is refused with the server’s sentence', async () => {
    const stub = stubFetch([
      {
        status: 200,
        body: { root: '/w', path: 'a.bin', name: 'a.bin', kind: 'binary', error: 'This file is not text, so it cannot be shown in the editor.' },
      },
    ]);
    try {
      const result = await resolveOpenableFile('/w/a.bin');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toContain('not text');
    } finally {
      stub.restore();
    }
  });

  test('a grant that refuses keeps the grant’s own reason', async () => {
    const stub = stubFetch([
      { status: 403, body: { error: 'outside', code: 'outside_workspace' } },
      { status: 400, body: { error: 'That directory cannot be opened from here.' } },
    ]);
    try {
      const result = await resolveOpenableFile('/r.pdf');
      expect(result).toEqual({ ok: false, message: 'That directory cannot be opened from here.' });
    } finally {
      stub.restore();
    }
  });

  test('an unreachable console is a sentence, not a throw', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('offline');
    }) as unknown as typeof globalThis.fetch;
    try {
      const result = await resolveOpenableFile('/w/a.md');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toContain('Could not reach the console');
    } finally {
      globalThis.fetch = original;
    }
  });
});
