/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The credential handover channel, and why it is a pipe rather than the
 * environment.
 *
 * The load-bearing fact these tests exist for: `delete Bun.env.X` removes the
 * name from the JS view only. Bun builds a child's environment from the OS
 * environ, which still carries the value — measured on 1.4.3, a `Bun.spawn`
 * with no `env` handed the password to the child, and so did the real
 * `runShell` path that builds a third-party plugin. Every assertion below is
 * either that fact or a consequence of it.
 */

import { afterEach, describe, expect, test } from 'bun:test';

import {
  parseHandover,
  PASSWORD_HANDOVER_ENV,
  PASSWORD_HANDOVER_STDIN,
  readHandoverFromStdin,
  serializeHandover,
} from '@/shared/lib/auth/handover';
import { uiPasswordHandover } from '@/cli/lib/ui-password.js';

const PASSWORD = 'hunter2-do-not-leak';

describe('serializeHandover / parseHandover', () => {
  test('a plaintext payload round-trips', () => {
    expect(parseHandover(serializeHandover({ password: PASSWORD }))).toEqual({ password: PASSWORD });
  });

  test('a hashed payload round-trips, with the secret its key was derived from', () => {
    const payload = { passwordHash: 'hash', credentialKey: 'key', sessionSecret: 'secret' };
    expect(parseHandover(serializeHandover(payload))).toEqual(payload);
  });

  // A replacement that received the hash but not the secret would derive a
  // different key and sign every session out — so the pair is refused without it.
  test('a hash without its secret is not a usable payload', () => {
    expect(parseHandover(JSON.stringify({ v: 1, passwordHash: 'h', credentialKey: 'k' }))).toBeNull();
  });

  test('malformed input reads as no credential, never as a crash', () => {
    expect(parseHandover('not json')).toBeNull();
    expect(parseHandover('')).toBeNull();
    expect(parseHandover(null)).toBeNull();
    expect(parseHandover('"a string"')).toBeNull();
    expect(parseHandover('{}')).toBeNull();
  });

  test('only the first line is read, so a trailing newline is harmless', () => {
    expect(parseHandover(`${serializeHandover({ password: PASSWORD })}\nextra\n`)).toEqual({ password: PASSWORD });
  });
});

describe('readHandoverFromStdin', () => {
  test('a spawn with no marker never reads stdin', async () => {
    // A server started from a shell has a terminal on stdin; reading it would
    // block the boot forever.
    expect(await readHandoverFromStdin({})).toBeNull();
  });

  test('the marker is consumed, so a grandchild cannot see it', async () => {
    const env = { [PASSWORD_HANDOVER_ENV]: PASSWORD_HANDOVER_STDIN };
    // No stdin payload is available in this process, so the read answers null —
    // but the marker must already be gone, which is the half under test.
    await readHandoverFromStdin(env);
    expect(env[PASSWORD_HANDOVER_ENV]).toBeUndefined();
  });
});

describe('uiPasswordHandover', () => {
  test('the password travels in the payload, never in the environment', () => {
    const { env, payload } = uiPasswordHandover({ password: PASSWORD }, { PATH: '/usr/bin' });
    expect(payload).toBe(serializeHandover({ password: PASSWORD }));
    // Nothing in the environment may carry the secret.
    expect(JSON.stringify(env)).not.toContain(PASSWORD);
    expect(env[PASSWORD_HANDOVER_ENV]).toBe(PASSWORD_HANDOVER_STDIN);
    expect(env.PATH).toBe('/usr/bin');
  });

  test('a legacy variable inherited from the shell is removed from the child', () => {
    // The operator's own `OMPCHAMBER_UI_PASSWORD` would otherwise reach every
    // grandchild, because the server cannot delete it from the OS environ.
    const { env, payload } = uiPasswordHandover({ password: PASSWORD }, { OMPCHAMBER_UI_PASSWORD: 'stale' });
    expect(env.OMPCHAMBER_UI_PASSWORD).toBeUndefined();
    expect(payload).not.toBeNull();
  });

  test('no password means no marker and no payload', () => {
    const { env, payload } = uiPasswordHandover(null, { PATH: '/usr/bin' });
    expect(payload).toBeNull();
    expect(env[PASSWORD_HANDOVER_ENV]).toBeUndefined();
  });
});

describe('the environment is not a channel a child can be trusted with', () => {
  const original = Bun.env.OMPCHAMBER_TEST_LEAK;
  afterEach(() => {
    if (original === undefined) delete Bun.env.OMPCHAMBER_TEST_LEAK;
    else Bun.env.OMPCHAMBER_TEST_LEAK = original;
  });

  // The measurement the whole module exists for, and it is narrower than "delete
  // never works": a value the process INHERITED at startup survives `delete`
  // (Bun rebuilds the child's environ from the original one), while a value set
  // at runtime is genuinely removed. A server spawned with the password in its
  // environment is therefore the case that leaks — which is exactly how the CLI
  // used to hand it over.
  //
  // The probes read the variable with `Bun.env` rather than a shell expansion:
  // these assertions are about the environment a child INHERITS, which has
  // nothing to do with the platform, and `/bin/sh` does not exist on the Windows
  // leg. Measured on CI: all three failed there with `uv_spawn '/bin/sh'`.
  test('a value inherited at startup survives `delete Bun.env.X` for a child', async () => {
    // Built by concatenation rather than a nested template: `${...}` inside a
    // template literal would be interpolated by Bun.
    const script = [
      'delete Bun.env.OMPCHAMBER_TEST_LEAK;',
      'const child = Bun.spawn([process.execPath,"-e","console.log(Bun.env.OMPCHAMBER_TEST_LEAK ?? \\"<unset>\\")"], { stdout: "pipe" });',
      'await child.exited;',
      'console.log(new TextDecoder().decode(await new Response(child.stdout).arrayBuffer()));',
    ].join('\n');
    const probe = Bun.spawn([process.execPath, '-e', script], {
      stdout: 'pipe',
      env: { ...Bun.env, OMPCHAMBER_TEST_LEAK: PASSWORD },
    });
    await probe.exited;
    expect(new TextDecoder().decode(await new Response(probe.stdout).arrayBuffer()).trim()).toBe(PASSWORD);
  });

  test('a value set at runtime IS removed by delete, and the child agrees', async () => {
    Bun.env.OMPCHAMBER_TEST_LEAK = PASSWORD;
    delete Bun.env.OMPCHAMBER_TEST_LEAK;
    const child = Bun.spawn([process.execPath, '-e', 'console.log(Bun.env.OMPCHAMBER_TEST_LEAK ?? "<unset>")'], { stdout: 'pipe' });
    await child.exited;
    expect(new TextDecoder().decode(await new Response(child.stdout).arrayBuffer()).trim()).toBe('<unset>');
  });

  test('an explicit env replaces the child environment, so a removal there is real', async () => {
    Bun.env.OMPCHAMBER_TEST_LEAK = PASSWORD;
    const env = { ...Bun.env };
    delete env.OMPCHAMBER_TEST_LEAK;
    const child = Bun.spawn([process.execPath, '-e', 'console.log(Bun.env.OMPCHAMBER_TEST_LEAK ?? "<unset>")'], { stdout: 'pipe', env });
    await child.exited;
    expect(new TextDecoder().decode(await new Response(child.stdout).arrayBuffer()).trim()).toBe('<unset>');
    delete Bun.env.OMPCHAMBER_TEST_LEAK;
  });
});
