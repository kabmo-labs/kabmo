/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What the fork composer sends to `/api/sessions/:id/fork`.
 *
 * Omitted fields let the fork keep the source's own model/thinking level and
 * an absent message lets it branch without a first turn — both are normal.
 */

import { describe, expect, test } from 'bun:test';
import { forkRequestBody } from '@/client/hooks/chat/timeline/fork-request';

describe('forkRequestBody', () => {
  test('carries the anchor and every pick the composer made', () => {
    expect(
      forkRequestBody('u2', {
        prompt: 'try another angle',
        images: [{ type: 'image', data: 'aGk=', mimeType: 'image/png' }],
        model: { provider: 'acme', modelId: 'big' },
        thinkingLevel: 'high',
        accessMode: 'write',
      }),
    ).toEqual({
      anchorEntryId: 'u2',
      prompt: 'try another angle',
      images: [{ type: 'image', data: 'aGk=', mimeType: 'image/png' }],
      model: { provider: 'acme', modelId: 'big' },
      thinkingLevel: 'high',
      accessMode: 'write',
    });
  });

  test('a bare fork sends only the anchor', () => {
    expect(forkRequestBody('a2')).toEqual({ anchorEntryId: 'a2' });
    expect(
      forkRequestBody('a2', {
        prompt: '   ',
        images: [],
        model: null,
        thinkingLevel: 'auto',
        accessMode: null,
      }),
    ).toEqual({ anchorEntryId: 'a2' });
  });

  test('a half-named model is not sent', () => {
    expect(forkRequestBody('u1', { model: { provider: '', modelId: 'x' } })).toEqual({
      anchorEntryId: 'u1',
    });
  });
});
