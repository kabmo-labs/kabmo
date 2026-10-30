/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The process-level rejection guard.
 *
 * The property worth pinning is the one a crash taught: a rejection from code
 * this server does not own must produce a LOG LINE and leave the process alive,
 * because the alternative is every live session dying with it. The listener is
 * asserted directly (rather than by rejecting inside a test) so the spec cannot
 * itself trip the runner's own unhandled-rejection handling.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import {
  describeRejection,
  installRejectionGuard,
  resetRejectionGuardForTests,
} from '@/server/lib/lifecycle/rejection-guard';

afterEach(() => {
  process.removeAllListeners('unhandledRejection');
  resetRejectionGuardForTests();
});

describe('describeRejection', () => {
  test('an Error reports its stack, which names the line that threw', () => {
    const described = describeRejection(new Error('disk I/O error'));
    expect(described).toContain('disk I/O error');
    expect(described).toContain('at ');
  });

  test('a thrown string is passed through', () => {
    expect(describeRejection('boom')).toBe('boom');
  });

  test('a plain object is serialized', () => {
    expect(describeRejection({ code: 'SQLITE_IOERR_VNODE' })).toBe('{"code":"SQLITE_IOERR_VNODE"}');
  });

  test('a value with a circular reference still produces a line', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(describeRejection(circular)).toBe('[object Object]');
  });
});

describe('installRejectionGuard', () => {
  test('installs exactly one listener, however many times the entry re-runs', () => {
    installRejectionGuard();
    installRejectionGuard();
    installRejectionGuard();
    expect(process.listenerCount('unhandledRejection')).toBe(1);
  });

  test('the installed listener logs instead of throwing, so the process survives', () => {
    const logged: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void logged.push(args.map(String).join(' '));
    try {
      installRejectionGuard();
      const listener = process.listeners('unhandledRejection')[0] as (reason: unknown) => void;
      expect(() => listener(new Error('plugin sampler died'))).not.toThrow();
    } finally {
      console.error = original;
    }
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('plugin sampler died');
    expect(logged[0]).toContain('contained');
  });

  test('it never claims uncaughtException — a synchronous throw still fails fast', () => {
    const before = process.listenerCount('uncaughtException');
    installRejectionGuard();
    expect(process.listenerCount('uncaughtException')).toBe(before);
  });
});
