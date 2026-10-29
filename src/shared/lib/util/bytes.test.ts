/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `bodyBytes` pinned on the two cases that differ: a plain-backed view must be
 * returned without copying (every served asset goes through it), and a
 * shared-backed view must come back usable rather than typed into a lie.
 */

import { describe, expect, test } from 'bun:test';
import { bodyBytes } from '@/shared/lib/util/bytes';

describe('bodyBytes', () => {
  test('a plain-backed view is returned as the same view, not a copy', () => {
    const source = new Uint8Array([1, 2, 3]);
    const out = bodyBytes(source);
    expect(out).toBe(source);
    expect(out.buffer).toBe(source.buffer);
  });

  test('a shared-backed view is copied into a plain ArrayBuffer', () => {
    const shared = new SharedArrayBuffer(3);
    const view = new Uint8Array(shared);
    view.set([7, 8, 9]);

    const out = bodyBytes(view);

    expect(out).not.toBe(view);
    expect(out.buffer instanceof ArrayBuffer).toBe(true);
    expect([...out]).toEqual([7, 8, 9]);
  });

  test('the result is accepted as a Response body', async () => {
    const shared = new SharedArrayBuffer(2);
    new Uint8Array(shared).set([0x68, 0x69]);
    const response = new Response(bodyBytes(new Uint8Array(shared)));
    expect(await response.text()).toBe('hi');
  });
});
