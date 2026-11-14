/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/** Permission, the two transports, and the refusals that must stay quiet. */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import {
  requestNotificationPermission,
  showOsNotification,
} from '@/client/lib/notifications/os';

const DOM_GLOBALS = ['window', 'document', 'navigator'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
let win: Window;

beforeEach(() => {
  win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterEach(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) target[key] = nativeGlobals[key];
});

describe('a browser without the Notification API', () => {
  test('refuses permission instead of throwing', async () => {
    expect(await requestNotificationPermission()).toBe(false);
  });

  test('drops the banner instead of throwing', async () => {
    await expect(showOsNotification({ title: 'Kabmo', body: 'Done.' })).resolves.toBeUndefined();
  });
});

describe('inside a Kabmo shell', () => {
  type Call = { method: string; params?: Record<string, unknown> };

  function installShell(answer: (call: Call) => unknown): Call[] {
    const calls: Call[] = [];
    window.__kabmoCall = (method, params) => {
      calls.push({ method, params });
      return Promise.resolve(answer({ method, params }));
    };
    return calls;
  }

  afterEach(() => {
    delete window.__kabmoCall;
  });

  test('permission and the banner use the shell, not the browser API', async () => {
    const calls = installShell(({ method }) =>
      method === 'notification_request' ? { granted: true } : null);

    expect(await requestNotificationPermission()).toBe(true);
    await showOsNotification({
      title: 'Fix the build',
      body: 'Waiting for you.',
      tag: 'ask:s1',
      sessionId: 's1',
    });

    expect(calls).toEqual([
      { method: 'notification_request', params: {} },
      {
        method: 'notification_show',
        params: { title: 'Fix the build', body: 'Waiting for you.', tag: 'ask:s1', sessionId: 's1' },
      },
    ]);
  });

  test('the event moment and its duration travel as strings', async () => {
    const calls = installShell(() => ({ shown: true }));

    await showOsNotification({
      title: 'Fix the build',
      body: 'The run finished.',
      tag: 'finish:s1',
      sessionId: 's1',
      at: 1_763_000_000_000,
      durationMs: 192_000,
    });

    // Form-encoded transport: every param is a string, and a shell without the
    // slot ignores the ones it cannot draw.
    expect(calls[0]?.params).toEqual({
      title: 'Fix the build',
      body: 'The run finished.',
      tag: 'finish:s1',
      sessionId: 's1',
      when: '1763000000000',
      durationMs: '192000',
    });
  });

  test('an untagged notification does not send an empty tag', async () => {
    const calls = installShell(() => null);
    await showOsNotification({ title: 'Kabmo', body: 'Done.' });
    expect(calls[0]).toEqual({
      method: 'notification_show',
      params: { title: 'Kabmo', body: 'Done.' },
    });
  });

  test('a refused command is reported as false, never as a grant', async () => {
    window.__kabmoCall = () => Promise.reject(new Error('This shell does not support notification_request.'));
    expect(await requestNotificationPermission()).toBe(false);
    // The refusal must not escape as an unhandled rejection.
    await expect(showOsNotification({ title: 'Kabmo', body: 'Done.' })).resolves.toBeUndefined();
  });
});
