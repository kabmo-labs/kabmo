/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The constraint set is a contract with WebKit, not a tuning knob.
 *
 * `echoCancellation: true` — or leaving the field out, because the spec lets the
 * UA default it to true — selects a VoiceProcessingIO unit on macOS, and that
 * unit failed to bind the machine's input device (CoreAudio -10851), ending the
 * capture so every utterance looked like silence. A later edit that "restores"
 * echo cancellation would reintroduce a dead microphone that reports itself as
 * "No speech was detected", so the value is pinned here.
 */

import { describe, expect, test } from 'bun:test';
import { dictationAudioConstraints } from '@/shared/lib/dictation/constraints';

describe('dictationAudioConstraints', () => {
  test('echo cancellation is explicitly OFF', () => {
    expect(dictationAudioConstraints().echoCancellation).toBe(false);
  });

  test('the speech processors stay on', () => {
    const constraints = dictationAudioConstraints();
    expect(constraints.noiseSuppression).toBe(true);
    expect(constraints.autoGainControl).toBe(true);
  });

  test('no device preference means no device constraint', () => {
    expect(dictationAudioConstraints('').deviceId).toBeUndefined();
    expect(dictationAudioConstraints('   ').deviceId).toBeUndefined();
  });

  test('a stored device is asked for exactly, never as a preference', () => {
    // `ideal` would silently fall back to another microphone, which is a
    // different device than the one the user picked.
    expect(dictationAudioConstraints(' dev-7 ').deviceId).toEqual({ exact: 'dev-7' });
  });
});
