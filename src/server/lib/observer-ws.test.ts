/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The observer stream's wire contract.
 *
 * The hub encodes a fan-out frame ONCE and hands the same string to every
 * socket, so the transport must pass a string through untouched — a second
 * `JSON.stringify` would send a quoted JSON string and every client would fail
 * to parse it. Objects still take the encoding path, because per-connection
 * frames (a snapshot with its own sequence) are built per socket.
 */

import { describe, expect, test } from 'bun:test';

import { attachObserverStream, createObserverState } from '@/server/lib/observer-ws';

function connect(): { sent: string[]; push: (event: string, data: unknown) => void; teardown: () => void } {
  const sent: string[] = [];
  const state = createObserverState();
  const stream = attachObserverStream(state, {
    raw: {},
    send: (data: string) => {
      sent.push(data);
    },
    close: () => {},
  });
  return { sent, push: stream.push, teardown: state.teardown };
}

describe('attachObserverStream', () => {
  test('sends an already-encoded frame verbatim', () => {
    const { sent, push, teardown } = connect();
    const encoded = '{"t":"delta","topic":"sessions","seq":3,"payload":{}}';
    push('', encoded);
    expect(sent).toEqual([encoded]);
    teardown();
  });

  test('encodes an object frame once', () => {
    const { sent, push, teardown } = connect();
    push('', { t: 'snapshot', topic: 'sessions', seq: 1, payload: { ok: true } });
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!)).toEqual({ t: 'snapshot', topic: 'sessions', seq: 1, payload: { ok: true } });
    teardown();
  });
});
