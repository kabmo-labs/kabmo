/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';

import { restartAuthWarning, restartServeOptions, selectRestartTargets } from '@/cli/lib/restart-scope.js';

const devOn3000 = { port: 3000, pid: 11, launchMode: 'direct' };
const daemonOn3001 = { port: 3001, pid: 12, launchMode: 'daemon' };
const foregroundOn3002 = { port: 3002, pid: 13, launchMode: 'foreground' };

describe('selectRestartTargets', () => {
  // The reported bug: the lowest port won, which was a `bun run dev` the update
  // must not touch — so the daemon holding the replaced build was never
  // restarted and kept serving it.
  test('picks the CLI-owned instance over a lower-port unmanaged one', () => {
    expect(selectRestartTargets([devOn3000, daemonOn3001], false)).toEqual([daemonOn3001]);
  });

  // With no owned instance there is still something to report, so the command
  // says why it is skipping rather than claiming nothing is running.
  test('falls back to the first live instance when none is owned', () => {
    expect(selectRestartTargets([devOn3000], false)).toEqual([devOn3000]);
    expect(selectRestartTargets([], false)).toEqual([]);
  });

  test('takes every owned instance, since each one serves the replaced build', () => {
    expect(selectRestartTargets([daemonOn3001, foregroundOn3002], false)).toEqual([daemonOn3001, foregroundOn3002]);
  });

  test('--all considers every instance, leaving the caller to skip the unmanaged', () => {
    const all = [devOn3000, daemonOn3001, foregroundOn3002];
    expect(selectRestartTargets(all, true)).toEqual(all);
  });

  test('an unreadable launch mode is not owned', () => {
    const unknown = { port: 4000, pid: 99, launchMode: undefined };
    expect(selectRestartTargets([unknown, daemonOn3001], false)).toEqual([daemonOn3001]);
  });
});

describe('restartServeOptions', () => {
  // The reported bug: a server started with `serve --startup` (whose login
  // entry runs `serve --foreground --tray`) came back after an auto-update with
  // NO tray icon. `restart` and `update` are separate invocations, so spreading
  // their own options into `serve` silently dropped `--tray` (and `--tls`).
  const trayInstance = { port: 3001, host: '0.0.0.0', mode: 'prod', launchMode: 'foreground', tray: true, tls: false };

  test('reproduces the tray flag of the instance it replaces', () => {
    expect(restartServeOptions(trayInstance).tray).toBe(true);
  });

  test('reproduces TLS, and a missing flag is false rather than inherited', () => {
    expect(restartServeOptions({ ...trayInstance, tray: false, tls: true }).tls).toBe(true);
    // An older record has no flags at all: the replacement must not claim them.
    const legacy = { port: 3002, host: '127.0.0.1', mode: 'prod', launchMode: 'daemon' };
    expect(restartServeOptions(legacy)).toMatchObject({ tray: false, tls: false });
  });

  test('the command line can add a flag but never remove one', () => {
    // `restart --tray` is a real request to show an icon, so it is honoured.
    // Its ABSENCE is not a request to hide one — the parser defaults the flag to
    // false, so treating that as an instruction would strip the icon from the
    // very instance the user asked to restart.
    const plainDaemon = { port: 3003, host: '127.0.0.1', mode: 'prod', launchMode: 'daemon' };
    expect(restartServeOptions(plainDaemon, { tray: true }).tray).toBe(true);
    expect(restartServeOptions(trayInstance, { tray: false }).tray).toBe(true);
    expect(restartServeOptions(plainDaemon, { tray: false }).tray).toBe(false);
  });

  test('the instance decides the address and the mode, not the command', () => {
    // A restart of a different port must not be retargeted by the flag that
    // scoped it, and a recorded prod instance stays prod.
    const options = restartServeOptions({ ...trayInstance, tray: false }, { tray: true, tls: true, port: 9999 });
    expect(options).toMatchObject({ port: 3001, host: '0.0.0.0', lan: true, prod: true });
  });

  test('the replacement is always the detached daemon', () => {
    // A `foreground` instance was held open by launchd, which is gone by the
    // time a restart is spawned; reproducing `--foreground` would tie the
    // replacement to a terminal nobody is watching.
    expect(restartServeOptions(trayInstance, { foreground: true, all: true }))
      .toMatchObject({ foreground: false, all: false });
  });

  test('a dev instance asks for --dev and not --prod', () => {
    const options = restartServeOptions({ ...trayInstance, mode: 'dev' });
    expect(options.dev).toBe(true);
    expect(options.prod).toBe(false);
  });
});

describe('restartAuthWarning', () => {
  // A MANUAL restart cannot carry the credential: the original server never
  // stored the password (only an argon2 hash lived in its memory). Before this
  // warning, that restart came back with authentication silently DISABLED —
  // measured: a run started with `--ui-password` answered `required: false`.
  const authInstance = { port: 3001, host: '127.0.0.1', mode: 'prod', launchMode: 'daemon', auth: true };

  test('names the port and says the replacement starts open', () => {
    const warning = restartAuthWarning(authInstance, null);
    expect(warning).toContain('port 3001');
    expect(warning).toContain('WITHOUT a password');
    expect(warning).toContain('--ui-password');
  });

  test('is silent when the replacement already received the credential', () => {
    // The self-restart path hands the hashed credential over, so auth survives
    // and there is nothing to warn about.
    expect(restartAuthWarning(authInstance, '{"passwordHash":"h"}')).toBeNull();
  });

  test('is silent for an instance that ran without authentication', () => {
    expect(restartAuthWarning({ ...authInstance, auth: false }, null)).toBeNull();
    expect(restartAuthWarning({ port: 3002, host: '127.0.0.1' }, null)).toBeNull();
  });
});
