/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The wait that turns opencode's five-second plugin-activation refusal into a
 * session, without turning a real refusal into a two-minute hang.
 *
 * Measured on 2.2.5: `session/new` answered `ServiceUnavailableError` at +6 s
 * while the Claude-bridge plugin list was still activating, and the same
 * process answered a real session at +80 s.
 */

import { describe, expect, test } from 'bun:test';
import {
  newSessionAfterActivation,
  pluginActivationPending,
} from '@/server/lib/harness/acp/activation';

const pending = () => new Error(
  'Internal error: Internal service failure: {"errorName":"ServiceUnavailableError"}',
);

describe('pluginActivationPending', () => {
  test('names the wire error the transport folds into the message', () => {
    expect(pluginActivationPending(pending())).toBe(true);
    expect(pluginActivationPending(new Error('Authentication required'))).toBe(false);
    expect(pluginActivationPending('ServiceUnavailableError')).toBe(true);
  });
});

describe('newSessionAfterActivation', () => {
  test('retries the same process while opencode activates its plugins', async () => {
    let calls = 0;
    const result = await newSessionAfterActivation(
      'opencode',
      '/tmp/work',
      async (cwd, timeoutMs) => {
        calls += 1;
        expect(cwd).toBe('/tmp/work');
        expect(timeoutMs).toBe(120_000);
        if (calls < 3) throw pending();
        return { sessionId: 'ses_1' };
      },
      { retryMs: 1 },
    );
    expect(result.sessionId).toBe('ses_1');
    expect(calls).toBe(3);
  });

  test('a non-activation refusal is final', async () => {
    let calls = 0;
    const failure = newSessionAfterActivation('opencode', '/tmp/work', async () => {
      calls += 1;
      throw new Error('Authentication required');
    });
    await expect(failure).rejects.toThrow('Authentication required');
    expect(calls).toBe(1);
  });

  test('other harnesses are never retried', async () => {
    let calls = 0;
    const failure = newSessionAfterActivation('omp-acp', '/tmp/work', async () => {
      calls += 1;
      throw pending();
    }, { retryMs: 1 });
    await expect(failure).rejects.toThrow('ServiceUnavailableError');
    expect(calls).toBe(1);
  });

  test('a plugin that never activates still ends in a stated refusal', async () => {
    let calls = 0;
    const failure = newSessionAfterActivation('opencode', '/tmp/work', async () => {
      calls += 1;
      throw pending();
    }, { retryMs: 1, totalMs: 0 });
    await expect(failure).rejects.toThrow('plugin activation did not finish within 0s');
    expect(calls).toBe(1);
  });
});
