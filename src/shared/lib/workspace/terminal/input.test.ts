/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import { terminalInputFrame } from '@/shared/lib/workspace/terminal/input';

describe('terminalInputFrame', () => {
  test('keeps ordinary text on the text channel', () => {
    expect(terminalInputFrame('echo ok\r')).toEqual({ text: 'echo ok\r' });
    expect(terminalInputFrame('ả 漢')).toEqual({ text: 'ả 漢' });
  });

  test('routes an X10 mouse report as latin-1 bytes, including values above 127', () => {
    // ESC [ M, button 0, column 188 (+32 = 220), row 3 (+32 = 35).
    const frame = terminalInputFrame('\x1b[M\x20\xdc\x23');
    expect(frame.text).toBeUndefined();
    expect([...(frame.bytes ?? [])]).toEqual([27, 91, 77, 32, 220, 35]);
    expect(frame.bytes?.length).toBe(6);
  });

  test('does not treat a truncated prefix as a mouse report', () => {
    expect(terminalInputFrame('\x1b[M')).toEqual({ text: '\x1b[M' });
    expect(terminalInputFrame('\x1b[M\x20')).toEqual({ text: '\x1b[M\x20' });
  });
});
