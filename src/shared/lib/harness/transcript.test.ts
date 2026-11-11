/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The fact two features share: which harness's conversation Kabmo can read off
 * disk (rewind truncates it, a fork cuts it at a message).
 */

import { describe, expect, test } from 'bun:test';
import { harnessHasLocalTranscript } from '@/shared/lib/harness/transcript';

describe('harnessHasLocalTranscript', () => {
  test('omp over either transport writes the JSONL Kabmo reads', () => {
    expect(harnessHasLocalTranscript('omp-rpc')).toBe(true);
    expect(harnessHasLocalTranscript('omp-acp')).toBe(true);
  });

  test('an ACP agent with its own store has no local transcript', () => {
    expect(harnessHasLocalTranscript('claude')).toBe(false);
    expect(harnessHasLocalTranscript('zcode')).toBe(false);
  });

  test('an unresolved harness keeps the historical allow', () => {
    expect(harnessHasLocalTranscript(null)).toBe(true);
    expect(harnessHasLocalTranscript(undefined)).toBe(true);
  });
});
