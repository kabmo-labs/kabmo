/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A config write must leave the session naming the model the agent is actually
 * serving.
 *
 * The protocol says `session/set_config_option` replies with the complete list,
 * and the agent's `currentValue` is authoritative (an alias or fallback may
 * differ from the request). This suite pins the fallback for a harness that
 * answers `{}` — the shape that left a chat's footer and sidebar row on the
 * model from `session/new` for the rest of its life.
 */

import { describe, expect, test } from 'bun:test';
import { adoptConfigAnswer, adoptConfigList, publishConfigChange } from '@/server/lib/harness/acp/session-config';
import type { AcpConfigOption } from '@/server/lib/harness/acp/protocol';

const option = (id: string, category: string, currentValue: string, values: string[]): AcpConfigOption => ({
  id,
  category,
  type: 'select',
  currentValue,
  options: values.map((value) => ({ value })),
});

const target = () => ({
  harness: 'claude' as const,
  configOptions: [option('sel-model', 'model', 'p/old', ['p/old', 'p/new'])],
  runModel: { provider: 'p', modelId: 'old' },
});

describe('ACP config adoption', () => {
  test('a reply that omits the list adopts the value that was written', () => {
    const session = target();
    adoptConfigAnswer(session, {}, { configId: 'sel-model', value: 'p/new' });
    expect(session.configOptions[0]?.currentValue).toBe('p/new');
    expect(session.runModel).toEqual({ provider: 'p', modelId: 'new' });
  });

  test('the agent’s resolved list wins over the request', () => {
    const session = target();
    adoptConfigAnswer(
      session,
      { configOptions: [option('sel-model', 'model', 'p/resolved', ['p/old', 'p/new', 'p/resolved'])] },
      { configId: 'sel-model', value: 'p/new' },
    );
    expect(session.runModel).toEqual({ provider: 'p', modelId: 'resolved' });
  });

  test('the array-shaped value some harnesses publish keeps its provider', () => {
    const session = target();
    adoptConfigList(session, [option('sel-model', 'model', '["kenari","deepseek-v4-flash"]', ['["kenari","deepseek-v4-flash"]'])]);
    expect(session.runModel).toEqual({ provider: 'kenari', modelId: 'deepseek-v4-flash' });
  });

  test('a pushed list announces the identity the client must re-read', () => {
    const emitted: Array<Record<string, unknown> & { type: string }> = [];
    const session = {
      ...target(),
      sessionId: 's1',
      isStreaming: false,
      emit: (event: Record<string, unknown> & { type: string }) => {
        emitted.push(event);
      },
    };
    adoptConfigList(session, [option('sel-model', 'model', 'p/new', ['p/new'])]);
    publishConfigChange(session);
    expect(emitted).toContainEqual({ type: 'model_changed' });
  });
});
