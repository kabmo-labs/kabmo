/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The stored-model snapshot is a RE-TARGET, not part of the message.
 *
 * A harness that publishes no model or thinking selector answers the verb with
 * an error (ACP: "This harness exposes no model selector"). Letting that abort
 * the delivery re-queued the user's message forever — measured in the delivery
 * loop, which retries a failed dispatch every two seconds.
 */

import { describe, expect, test } from 'bun:test';
import { applyModelSnapshot, promptCommand } from '@/server/lib/queue/payload';

const model = { provider: 'claude', modelId: 'default', thinkingLevel: 'high', accessMode: 'always-ask' as const };

describe('applyModelSnapshot', () => {
  test('writes the model, then the thinking level', async () => {
    const sent: Record<string, unknown>[] = [];
    await applyModelSnapshot(async (command) => { sent.push(command); }, model);
    expect(sent).toEqual([
      { type: 'set_model', provider: 'claude', modelId: 'default' },
      { type: 'set_thinking_level', level: 'high' },
    ]);
  });

  test('a refused selector does not stop the prompt from being delivered', async () => {
    const sent: Record<string, unknown>[] = [];
    await applyModelSnapshot(async (command) => {
      sent.push(command);
      throw new Error('This harness exposes no model selector');
    }, model);
    // Both writes were attempted, and the caller gets no rejection, so the
    // queued prompt that follows is still dispatched.
    expect(sent).toHaveLength(2);
  });

  test("'auto' leaves the thinking level untouched", async () => {
    const sent: Record<string, unknown>[] = [];
    await applyModelSnapshot(async (command) => { sent.push(command); }, { ...model, thinkingLevel: 'auto' });
    expect(sent.map((command) => command.type)).toEqual(['set_model']);
  });

  test('no snapshot writes nothing', async () => {
    const sent: Record<string, unknown>[] = [];
    await applyModelSnapshot(async (command) => { sent.push(command); }, null);
    expect(sent).toEqual([]);
  });
});

describe('promptCommand', () => {
  test('carries the access tier and flattens a stored text attachment', () => {
    const command = promptCommand({
      text: 'see the file',
      attachments: [
        { id: 'a1', name: 'notes.txt', type: 'text/plain', size: 4, content: 'body', preview: '' },
      ],
      model: { ...model, accessMode: 'yolo' },
    });
    expect(command.type).toBe('prompt');
    expect(command.accessMode).toBe('yolo');
    expect(String(command.message)).toContain('body');
  });
});
