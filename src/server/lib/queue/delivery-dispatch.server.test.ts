/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What a queue dispatch actually sends: the model snapshot it was queued with,
 * the attachment payloads it can carry, and the timer-free nudge.
 *
 * The scheduling contract — when a delivery runs, defers, or recovers — lives
 * in `delivery.server.test.ts`; both files share `delivery-harness.ts`, which
 * owns the store mock and the fake clock.
 */

import { afterAll, afterEach, beforeAll, describe, expect, jest, mock, test } from 'bun:test';
import type { QueuedMessage } from '@/shared/types/chat';
import type { QueueDeliveryHost } from '@/server/lib/queue/delivery.server';
import {
  MODEL,
  beginQueueTest,
  deliverQueueNow,
  flush,
  installStoreMock,
  makeHost,
  queue,
  queueItem,
  restoreStore,
  settleDelivery,
} from '@/server/lib/queue/delivery-harness';

beforeAll(() => {
  installStoreMock();
});

afterEach(() => {
  jest.useRealTimers();
});

afterAll(() => {
  mock.restore();
  // Hand the real SQLite store back: `mock.module` would otherwise stay
  // registered for every suite that runs after this file.
  restoreStore();
});

describe('queue dispatch', () => {
  test('delivers the head with the model snapshot it was queued with', async () => {
    const sessionId = beginQueueTest();
    queue.set(sessionId, [queueItem('queued hello')]);
    const { host, sent } = makeHost(sessionId);

    await settleDelivery(host);

    expect(sent).toEqual([
      { type: 'set_model', provider: 'kenari', modelId: 'deepseek-v4-pro' },
      { type: 'set_thinking_level', level: 'max' },
      { type: 'prompt', message: 'queued hello', accessMode: 'yolo' },
    ]);
    expect(queue.get(sessionId)).toEqual([]);
  });

  test("an 'auto' thinking level is left to the session", async () => {
    const sessionId = beginQueueTest();
    queue.set(sessionId, [queueItem('no level', { ...MODEL, thinkingLevel: 'auto' })]);
    const { host, sent } = makeHost(sessionId);

    await settleDelivery(host);

    expect(sent).toEqual([
      { type: 'set_model', provider: 'kenari', modelId: 'deepseek-v4-pro' },
      { type: 'prompt', message: 'no level', accessMode: 'yolo' },
    ]);
  });

  test('an item with no model snapshot is sent without touching the model', async () => {
    const sessionId = beginQueueTest();
    queue.set(sessionId, [queueItem('session model', null)]);
    const { host, sent } = makeHost(sessionId);

    await settleDelivery(host);

    expect(sent).toEqual([{ type: 'prompt', message: 'session model' }]);
  });

  // The real wrapper's `send` is a CLASS METHOD that reads its own runtime state
  // through `this`, so a dispatch that hands it over detached runs against
  // `undefined`. Measured in production on every queued item that carried a
  // model snapshot: `undefined is not an object (evaluating 'e.restarting')`,
  // the item was re-queued, and the queue retried it every 2s forever — the
  // follow-up only ever left the queue when the operator re-sent it by hand.
  // `makeHost`'s arrow function cannot see this, so the host here is an object
  // whose `send` reads a field of itself.
  test('the model snapshot and the prompt keep the session as their receiver', async () => {
    const sessionId = beginQueueTest();
    queue.set(sessionId, [queueItem('receiver check')]);
    const sent: Record<string, unknown>[] = [];
    let receiverLost = false;
    const host: QueueDeliveryHost = {
      sessionId,
      isAlive: () => true,
      isBusy: () => false,
      // `this` is the host: the detached call sites read `restarting` off it.
      restarting: false,
      async send(this: { restarting: boolean }, command: Record<string, unknown>) {
        if (this?.restarting !== false) receiverLost = true;
        sent.push(command);
        return {};
      },
    } as QueueDeliveryHost;

    await settleDelivery(host);

    expect(receiverLost).toBe(false);
    expect(sent.map((c) => c.type)).toEqual(['set_model', 'set_thinking_level', 'prompt']);
    expect(queue.get(sessionId)).toEqual([]);
  });

  // Attachments reach the server as the persisted display fields only: the
  // composer's `File` never survives the queue row's JSON round trip, and its
  // image preview is a `blob:` object URL the server cannot read. These pin the
  // fields the delivery must use instead — `dataBase64` for the bytes, `type`
  // for the media type, `content` for an inline-able text file.
  test('a queued image rides its persisted base64 payload', async () => {
    const sessionId = beginQueueTest();
    const item = queueItem('with image', null);
    item.attachments = [
      { id: 'i', name: 'shot.png', type: 'image/png', size: 4, preview: 'blob:http://x/1', dataBase64: 'iVBORw0KGgo=' },
    ] as QueuedMessage['attachments'];
    queue.set(sessionId, [item]);
    const { host, sent } = makeHost(sessionId);

    await settleDelivery(host);

    expect(sent).toEqual([
      {
        type: 'prompt',
        message: 'with image',
        images: [{ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }],
      },
    ]);
  });

  test('a queued text file is inlined into the delivered prompt', async () => {
    const sessionId = beginQueueTest();
    const item = queueItem('review this', null);
    item.attachments = [
      { id: 't', name: 'notes.md', type: 'text/markdown', size: 5, preview: '', content: '# hi' },
    ] as QueuedMessage['attachments'];
    queue.set(sessionId, [item]);
    const { host, sent } = makeHost(sessionId);

    await settleDelivery(host);

    const prompt = sent.find((c) => c.type === 'prompt');
    expect(prompt?.message).toBe('review this\n\nAttached file: notes.md\n```markdown\n# hi\n```');
  });

  test('an attachment without a payload is not sent as a blank image', async () => {
    const sessionId = beginQueueTest();
    const item = queueItem('no payload', null);
    item.attachments = [
      { id: 'i', name: 'broken.png', type: 'image/png', size: 4, preview: 'blob:http://x/1', dataBase64: '' },
    ] as QueuedMessage['attachments'];
    queue.set(sessionId, [item]);
    const { host, sent } = makeHost(sessionId);

    await settleDelivery(host);

    expect(sent).toEqual([{ type: 'prompt', message: 'no payload' }]);
  });

  // The nudge is the RECOVERY path, so it must not itself depend on the
  // mechanism it recovers from. A long-lived `--hot` dev server can stop firing
  // `setTimeout` callbacks entirely; a nudge that merely re-armed the settle
  // timer would fail exactly like the delivery it was meant to rescue. Here no
  // timer is ever advanced — the delivery must complete synchronously.
  test('a nudge delivers immediately without waiting on any timer', async () => {
    const sessionId = beginQueueTest();
    queue.set(sessionId, [queueItem('nudged')]);
    const { host, sent } = makeHost(sessionId);

    // The boolean is the client poll's stop signal: it is how the page knows a
    // tick actually sent something rather than finding nothing to do.
    const delivered = await deliverQueueNow(host);
    await flush();

    expect(delivered).toBe(true);
    expect(sent.filter((c) => c.type === 'prompt').length).toBe(1);
    expect(queue.get(sessionId)).toEqual([]);
  });

  test('a nudge on a busy session leaves the item queued and reports no delivery', async () => {
    const sessionId = beginQueueTest();
    queue.set(sessionId, [queueItem('busy nudge')]);
    const { host, sent } = makeHost(sessionId);
    host.isBusy = () => true;

    const delivered = await deliverQueueNow(host);
    await flush();

    expect(delivered).toBe(false);
    expect(sent).toEqual([]);
    expect(queue.get(sessionId)?.length).toBe(1);
  });

  test('a nudge with an empty queue reports no delivery', async () => {
    const sessionId = beginQueueTest();
    const { host } = makeHost(sessionId);

    const delivered = await deliverQueueNow(host);

    expect(delivered).toBe(false);
  });
});
