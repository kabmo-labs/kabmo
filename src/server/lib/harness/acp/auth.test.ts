/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `authenticate` step and the sentence a refused handshake shows.
 *
 * The failure this pins: an agent that advertises `cached_token` was asked for a
 * session it refused with `-32000 Authentication required`, and the operator got
 * that sentence with no command to run. Both halves matter — calling the method
 * when one is usable, and naming the agent's own sign-in line when none is.
 */

import { describe, expect, test } from 'bun:test';
import { authMethodsOf, describeSignIn, headlessAuthMethod, isAuthRequiredError } from '@kabmo-labs/kabmo-acp/client/auth';

describe('headlessAuthMethod', () => {
  test('prefers the machine credential', () => {
    expect(headlessAuthMethod([{ id: 'cursor_login', type: 'terminal' }, { id: 'cached_token' }], {})).toBe('cached_token');
  });

  test('adopts an env-keyed method only when that variable is set', () => {
    const methods = [{ id: 'xai.api_key' }];
    expect(headlessAuthMethod(methods, {})).toBeNull();
    expect(headlessAuthMethod(methods, { XAI_API_KEY: 'k' })).toBe('xai.api_key');
  });

  test('a terminal-only agent yields no call at all', () => {
    expect(headlessAuthMethod([{ id: 'cursor_login', type: 'terminal' }], {})).toBeNull();
  });
});

describe('describeSignIn', () => {
  test('prints the launch line plus the terminal method args and env', () => {
    expect(
      describeSignIn(
        [{ id: 'login', type: 'terminal', args: ['--login'], env: { GROK_HOME: '/tmp/g' } }],
        'grok agent stdio',
      ),
    ).toBe('To sign in, run this in a terminal on this machine, then try again: GROK_HOME=/tmp/g grok agent stdio --login');
  });

  test('names the offered methods when none is a terminal command', () => {
    expect(describeSignIn([{ id: 'a', name: 'Sign in A' }, { id: 'b', name: 'Sign in B' }], 'x acp')).toContain(
      'Sign in A, Sign in B',
    );
  });

  test('nothing to say when the agent offered nothing', () => {
    expect(describeSignIn([], 'x acp')).toBeNull();
  });
});

describe('isAuthRequiredError', () => {
  test('recognises the spec code and the agent’s own wording', () => {
    expect(isAuthRequiredError(Object.assign(new Error('nope'), { code: -32000 }))).toBe(true);
    expect(isAuthRequiredError(new Error('Authentication required: run grok login'))).toBe(true);
    expect(isAuthRequiredError(new Error('session not found'))).toBe(false);
  });
});

describe('authMethodsOf', () => {
  test('drops entries without an id', () => {
    expect(authMethodsOf({ protocolVersion: 1, authMethods: [{ id: 'a', name: 'A' }, { name: 'B' } as never] })).toEqual([
      { id: 'a', name: 'A' },
    ]);
  });
});
