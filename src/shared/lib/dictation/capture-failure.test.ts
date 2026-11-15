/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `describeCaptureFailure` is the composer's only report of WHY the microphone
 * did not open, so each branch is a message a user can act on — and the
 * fallback must keep the DOMException's name, because the unnamed version is
 * what made an Android WebView capture failure ("Could not open the
 * microphone") impossible to diagnose from the screen.
 */

import { describe, expect, test } from 'bun:test';
import { describeCaptureFailure } from '@/shared/lib/dictation/capture-failure';

describe('describeCaptureFailure', () => {
  test('names a refused permission', () => {
    expect(describeCaptureFailure(new DOMException('refused', 'NotAllowedError'))).toBe('Microphone permission denied.');
  });

  test('separates a device that could not start from a refused permission', () => {
    // Android WebView's message before MODIFY_AUDIO_SETTINGS was declared: the
    // permission WAS granted, so telling the user it was denied would be wrong.
    const message = describeCaptureFailure(new DOMException('refused', 'NotReadableError'));
    expect(message).toContain('could not be started');
    expect(message).not.toContain('permission denied');
  });

  test('separates a missing device', () => {
    expect(describeCaptureFailure(new DOMException('refused', 'NotFoundError'))).toBe('No microphone was found.');
  });

  test('keeps the name of an unclassified DOMException', () => {
    // The name is the only diagnosable part; dropping it is the bug this test
    // exists for.
    expect(describeCaptureFailure(new DOMException('refused', 'SecurityError'))).toBe(
      'Could not open the microphone (SecurityError).',
    );
  });

  test('a rejection that is not a DOMException says so without inventing a name', () => {
    expect(describeCaptureFailure(new Error('boom'))).toBe('Could not open the microphone.');
    expect(describeCaptureFailure(undefined)).toBe('Could not open the microphone.');
  });
});
