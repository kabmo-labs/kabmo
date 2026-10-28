/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The credential ladder, with the CLI and the environment faked.
 *
 * The order is the whole contract: a token the user typed must beat one the
 * shell exported, and both must beat whatever a CLI happens to have stored —
 * otherwise setting a token in the panel would appear to do nothing on a machine
 * where `gh` is logged into a different account.
 */

import { afterEach, describe, expect, test } from 'bun:test';

import { resetTokenCache, resolveToken } from './token';

afterEach(() => resetTokenCache());

const noCli = () => ({ ok: false, stdout: '' });

describe('resolveToken', () => {
  test('the setting wins over everything', () => {
    const resolved = resolveToken('github', {
      setting: 'ghp_setting',
      env: { GITHUB_TOKEN: 'ghp_env' },
      run: () => ({ ok: true, stdout: 'ghp_cli_0123456789abcdef' }),
    });
    expect(resolved).toEqual({ token: 'ghp_setting', source: 'setting' });
  });

  test('an empty setting falls through to the environment', () => {
    expect(resolveToken('github', { setting: '  ', env: { GITHUB_TOKEN: 'ghp_env' }, run: noCli })).toEqual({
      token: 'ghp_env',
      source: 'environment',
    });
    expect(resolveToken('github', { setting: null, env: { GH_TOKEN: 'gho_env' }, run: noCli })).toEqual({
      token: 'gho_env',
      source: 'environment',
    });
  });

  test('the environment falls through to the CLI', () => {
    expect(
      resolveToken('github', { setting: null, env: {}, run: () => ({ ok: true, stdout: 'ghp_cli_0123456789abcdef\n' }) }),
    ).toEqual({
      token: 'ghp_cli_0123456789abcdef',
      source: 'cli',
    });
  });

  test('gitlab reads its own variables, never github ones', () => {
    expect(resolveToken('gitlab', { setting: null, env: { GITHUB_TOKEN: 'ghp_x' }, run: noCli })).toEqual({
      token: null,
      source: 'none',
    });
    expect(resolveToken('gitlab', { setting: null, env: { GITLAB_TOKEN: 'glpat-x' }, run: noCli })).toEqual({
      token: 'glpat-x',
      source: 'environment',
    });
  });

  test('nothing anywhere is a legitimate answer', () => {
    expect(resolveToken('github', { setting: null, env: {}, run: noCli })).toEqual({ token: null, source: 'none' });
  });

  test('a CLI answer is read once per provider', () => {
    let calls = 0;
    const run = () => {
      calls += 1;
      return { ok: true, stdout: 'ghp_cli_0123456789abcdef' };
    };
    resolveToken('github', { setting: null, env: {}, run });
    resolveToken('github', { setting: null, env: {}, run });
    expect(calls).toBe(1);
  });

  test('a CLI failure is cached too, so a logged-out machine pays once', () => {
    let calls = 0;
    const run = () => {
      calls += 1;
      return { ok: false, stdout: '' };
    };
    expect(resolveToken('github', { setting: null, env: {}, run }).token).toBeNull();
    expect(resolveToken('github', { setting: null, env: {}, run }).token).toBeNull();
    expect(calls).toBe(1);
  });

  test('glab answers through its own status text', () => {
    const resolved = resolveToken('gitlab', {
      setting: null,
      env: {},
      run: () => ({ ok: true, stdout: 'gitlab.example.com\n  ✓ Logged in\n  Token: glpat-from-cli\n' }),
    });
    expect(resolved).toEqual({ token: 'glpat-from-cli', source: 'cli' });
  });

  test('a CLI line that is not a token is refused rather than used', () => {
    const resolved = resolveToken('github', {
      setting: null,
      env: {},
      run: () => ({ ok: true, stdout: 'not logged in' }),
    });
    expect(resolved.token).toBeNull();
  });
});
