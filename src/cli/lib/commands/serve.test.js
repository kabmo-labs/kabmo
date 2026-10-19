// `kabmo serve`'s flag rules that decide the process tree.
//
// Only the pure decisions are tested here: the command itself spawns a server,
// writes a login entry outside the data directory and blocks on a health check,
// none of which a unit test should perform. What IS worth pinning is the
// asymmetry below, because getting it backwards is silent — a missing icon, or
// a login entry the user never asked for.

import { describe, expect, test } from 'bun:test';

import { resolveHost, resolvePort, trayForOptions } from '@/cli/lib/commands/serve.js';

describe('trayForOptions', () => {
  // `--startup` implies the tray: a login-started console with no icon would be
  // invisible and unstoppable from the desktop. Measured: `serve --startup`
  // alone wrote a plist containing `--tray` and the running server logged
  // `tray: icon shown`.
  test('--startup raises an icon on its own', () => {
    expect(trayForOptions({ startup: true })).toBe(true);
  });

  // Which makes spelling both redundant — supported, never required.
  test('--startup --tray is the same request, not a different one', () => {
    expect(trayForOptions({ startup: true, tray: true })).toBe(true);
  });

  test('--tray alone raises an icon and registers nothing', () => {
    expect(trayForOptions({ tray: true })).toBe(true);
  });

  test('neither flag means no icon', () => {
    expect(trayForOptions({})).toBe(false);
    expect(trayForOptions(undefined)).toBe(false);
    // `--no-startup` is a REMOVAL, and must not turn an icon on for the run.
    expect(trayForOptions({ startup: false })).toBe(false);
  });
});

describe('resolvePort / resolveHost', () => {
  test('an explicit flag wins over the environment', () => {
    const previous = Bun.env.KABMO_PORT;
    Bun.env.KABMO_PORT = '5555';
    try {
      expect(resolvePort({ port: 6000 })).toBe(6000);
      expect(resolvePort({})).toBe(5555);
      expect(resolvePort({ port: null })).toBe(5555);
    } finally {
      if (previous === undefined) delete Bun.env.KABMO_PORT;
      else Bun.env.KABMO_PORT = previous;
    }
  });

  test('--lan is the bind-any address, and beats --host', () => {
    expect(resolveHost({ lan: true, host: '127.0.0.1' })).toBe('0.0.0.0');
    expect(resolveHost({ host: '192.168.1.4' })).toBe('192.168.1.4');
    expect(resolveHost({})).toBe('127.0.0.1');
  });
});
