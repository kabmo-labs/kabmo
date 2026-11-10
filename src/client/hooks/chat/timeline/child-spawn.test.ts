/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What a pending child chat sends to `/api/sessions/spawn`.
 *
 * The fields are OMITTED when the composer has no value: the route inherits the
 * parent's harness and model when they are absent, and sending `null`/`auto`
 * would override that inheritance with a value the agent never asked for.
 */

import { describe, expect, test } from 'bun:test';
import { childSpawnBody } from '@/client/hooks/chat/timeline/child-spawn';

describe('childSpawnBody', () => {
  test('carries the parent, prompt and every pick the composer made', () => {
    expect(
      childSpawnBody('parent', 'review this', {
        harness: 'claude',
        model: { provider: 'acme', modelId: 'big' },
        thinkingLevel: 'high',
        accessMode: 'yolo',
        images: [{ type: 'image', data: 'aGk=', mimeType: 'image/png' }],
      }),
    ).toEqual({
      parentSessionId: 'parent',
      prompt: 'review this',
      harness: 'claude',
      model: { provider: 'acme', modelId: 'big' },
      thinkingLevel: 'high',
      accessMode: 'yolo',
      images: [{ type: 'image', data: 'aGk=', mimeType: 'image/png' }],
    });
  });

  test('leaves unknown picks out so the server inherits them', () => {
    const body = childSpawnBody('parent', 'go', {
      harness: null,
      model: null,
      thinkingLevel: 'auto',
      accessMode: null,
      images: [],
    });
    expect(body).toEqual({ parentSessionId: 'parent', prompt: 'go' });
  });

  test('a half-named model is not sent', () => {
    const body = childSpawnBody('parent', 'go', {
      model: { provider: 'acme', modelId: '' },
    });
    expect(body).not.toHaveProperty('model');
  });
});
