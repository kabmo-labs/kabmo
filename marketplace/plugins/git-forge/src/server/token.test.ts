/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The credential ladder, with the CLI and the environment faked.
 *
 * The order is the whole contract: a token the user typed must beat one the
 * shell exported, and both must beat whatever a CLI happens to have stored —
 * otherwise setting a token in the panel would appear to do nothing on a machine
 * where `gh` is logged into a different account.
 *
 * The GitLab half also pins the ORDER of the CLI's own two commands: the local
 * `config get` first, because `auth status` verifies over the network and a host
 * that is slow or unreachable turned a stored token into "no credential".
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

describe('resolveToken — the GitLab CLI', () => {
  /**
   * Measured on glab 1.126: the report goes to STDERR, the token line is
   * `✓ Token found in configuration file (plaintext): <token>`, and the command
   * exits 1 as soon as ANY configured instance fails — even when this host's
   * token is fine. Each of those alone made the panel read a logged-in machine
   * as having no credential.
   */
  const report = [
    'gitlab.example.com',
    '  ✓ Logged in to gitlab.example.com as ana (config file)',
    '  ✓ Token found in configuration file (plaintext): glpat-real',
    '  ! To store this token more securely, run glab auth login',
  ].join('\n');

  test('it reads the token out of the status report, exit code regardless', () => {
    const resolved = resolveToken('gitlab', {
      setting: null,
      env: {},
      host: 'gitlab.example.com',
      run: () => ({ ok: false, stdout: report }),
    });
    expect(resolved).toEqual({ token: 'glpat-real', source: 'cli' });
  });

  test('a masked token is not a token', () => {
    const masked = 'gitlab.example.com\n  ✓ Token found in configuration file (plaintext): ******\n';
    expect(
      resolveToken('gitlab', { setting: null, env: {}, host: 'gitlab.example.com', run: () => ({ ok: true, stdout: masked }) })
        .token,
    ).toBeNull();
  });

  test('the call names the repository host, so another instance cannot answer for it', () => {
    const argv: string[][] = [];
    resolveToken('gitlab', {
      setting: null,
      env: {},
      host: 'gitlab.example.com',
      run: (args) => {
        argv.push(args);
        return { ok: true, stdout: report };
      },
    });
    // The local read is tried first: it needs no network. `auth status` verifies
    // against the API before printing, so on a host behind a VPN it burned the
    // whole spawn budget and a stored token read as "no credential" (measured).
    expect(argv[0]).toEqual(['glab', 'config', 'get', 'token', '--host', 'gitlab.example.com']);
    expect(argv[1]).toEqual(['glab', 'auth', 'status', '--show-token', '--hostname', 'gitlab.example.com']);
  });

  test('a local config read stops the ladder, so the verifying command never runs', () => {
    const argv: string[][] = [];
    resolveToken('gitlab', {
      setting: null,
      env: {},
      host: 'gitlab.example.com',
      run: (args) => {
        argv.push(args);
        return { ok: true, stdout: 'glpat-local\n' };
      },
    });
    expect(argv).toEqual([['glab', 'config', 'get', 'token', '--host', 'gitlab.example.com']]);
  });

  test('the answer is cached per host, not per provider', () => {
    const hosts: string[] = [];
    const run = (args: string[]) => {
      hosts.push(args[args.length - 1]);
      return { ok: true, stdout: 'glpat-per-host' };
    };
    resolveToken('gitlab', { setting: null, env: {}, host: 'a.example.com', run });
    resolveToken('gitlab', { setting: null, env: {}, host: 'b.example.com', run });
    resolveToken('gitlab', { setting: null, env: {}, host: 'a.example.com', run });
    expect(hosts).toEqual(['a.example.com', 'b.example.com']);
  });

  test('ansi colouring does not hide the token line', () => {
    const coloured = '\u001b[32m  ✓ Token found in configuration file (plaintext): glpat-ansi\u001b[0m';
    expect(
      resolveToken('gitlab', { setting: null, env: {}, host: 'h', run: () => ({ ok: true, stdout: coloured }) }).token,
    ).toBe('glpat-ansi');
  });
});
