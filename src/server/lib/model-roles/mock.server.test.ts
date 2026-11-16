/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The demo role catalog under `MOCK=true`.
 *
 * A demo install spawns no omp child, so `omp models` answers nothing and every
 * role dropdown would be empty. The non-chat rows exist because the five kind
 * roles accept a model of that kind only — a retired id there is a dropdown
 * that offers a model the real omp no longer has.
 */

import { describe, expect, test } from 'bun:test';

import { mockRoleCandidates } from '@/server/lib/model-roles/mock.server';

describe('mockRoleCandidates', () => {
  test('offers one candidate per non-chat kind, with a provider-qualified selector', () => {
    const kinds = new Set(mockRoleCandidates().map((candidate) => candidate.kind));
    for (const kind of ['search', 'tiny', 'stt', 'tts', 'image']) expect(kinds.has(kind as never)).toBe(true);
    for (const candidate of mockRoleCandidates()) {
      expect(candidate.selector).toBe(`${candidate.provider}/${candidate.id}`);
    }
  });

  test('names the local TTS model omp ships (Phonon 31M, not the retired Kokoro)', () => {
    // omp 18.21.0 replaced Kokoro-82M with Phonon 31M and migrates a stored
    // `local/kokoro` role on read; a demo row still naming Kokoro would offer a
    // selector the real install rewrites.
    const tts = mockRoleCandidates().filter((candidate) => candidate.kind === 'tts');
    expect(tts.map((candidate) => candidate.selector)).toEqual(['local/phonon-31m']);
  });
});
