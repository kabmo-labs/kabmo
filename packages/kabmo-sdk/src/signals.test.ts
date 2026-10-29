/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The one rule for reading a child's terminating signal, pinned.
 *
 * `bun-types` 1.4.4 widened `Subprocess.signalCode` to
 * `NodeJS.Signals | number | null`: Bun reports a name when the signal has one
 * and a number when it does not. Every field of ours that records the signal is
 * a `string | null`, so this is the single place the widening is closed — and
 * the cases that matter are the ones a naive `?? null` gets wrong.
 */

import { describe, expect, test } from 'bun:test';
import { signalName } from '@kabmo-labs/kabmo-sdk';

describe('signalName', () => {
  test('a named signal passes through unchanged', () => {
    expect(signalName('SIGTERM')).toBe('SIGTERM');
    expect(signalName('SIGKILL')).toBe('SIGKILL');
  });

  test('an unsignalled exit is null, not a label', () => {
    expect(signalName(null)).toBeNull();
    expect(signalName(undefined)).toBeNull();
  });

  test('an unnamed (real-time) signal keeps its number, as a label', () => {
    // Bun only reports a number when the signal has no name, so the number is
    // the only identity the OS gave us. Dropping it to null would report "no
    // signal" for a process that was in fact killed.
    expect(signalName(34)).toBe('SIG34');
    expect(signalName(0)).toBe('SIG0');
  });

  test('zero is a number, not a falsy absence', () => {
    expect(signalName(0)).not.toBeNull();
  });
});
