// The tray's decision layer: the login entry it registers, and the config a host
// reads.
//
// Pure content builders, on purpose. The plist a LaunchAgent reads, the
// `.desktop` file a freedesktop session reads and the Run value Windows stores
// are all strings, so they can be asserted without touching a real
// `~/Library/LaunchAgents`, a real `reg.exe` or a real session. What IS verified
// against the OS lives in the smoke runs recorded in AGENTS.md.

import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  installAutostart,
  isAutostartInstalled,
  renderDesktopEntry,
  renderLaunchAgent,
  renderWindowsRunValue,
  uninstallAutostart,
} from '@/server/lib/tray/autostart';
import { buildLoginEntryArgv } from '@/server/lib/tray/entry';
import { buildTrayConfig, trayUrl } from '@/server/lib/tray/config';
import { buildMenuModel, menuPayload } from '@/server/lib/tray/host/linux.js';

describe('buildLoginEntryArgv', () => {
  const base = { bun: '/bun', cli: '/pkg/src/cli/ompchamber.js', port: 3000, host: '127.0.0.1', tray: true, tls: false, lan: false };

  // The load-bearing rule: launchd reaps a job's process tree when the job's
  // program exits, so a detached `serve` (which returns as soon as the health
  // check passes) left nothing running. The entry must hold the CLI open.
  test('runs serve in the foreground, so the job does not exit', () => {
    const argv = buildLoginEntryArgv(base);
    expect(argv).toEqual(['/bun', '/pkg/src/cli/ompchamber.js', 'serve', '--foreground', '--prod', '--port', '3000', '--host', '127.0.0.1', '--tray']);
  });

  test('pins the mode, since a login entry has no shell to export NODE_ENV', () => {
    expect(buildLoginEntryArgv(base)).toContain('--prod');
  });

  test('carries the tray choice, so --startup alone starts without an icon', () => {
    const withoutIcon = buildLoginEntryArgv({ ...base, tray: false });
    expect(withoutIcon).not.toContain('--tray');
    expect(withoutIcon).toContain('serve');
  });

  test('expresses --lan as an explicit address, not a flag', () => {
    const lan = buildLoginEntryArgv({ ...base, lan: true, host: '0.0.0.0' });
    expect(lan).toContain('0.0.0.0');
    expect(lan).not.toContain('--lan');
  });

  test('carries --tls when the registering invocation served over TLS', () => {
    expect(buildLoginEntryArgv({ ...base, tls: true })).toContain('--tls');
  });
});

describe('renderLaunchAgent', () => {
  test('runs at load, and never restarts a server the user stopped', () => {
    const plist = renderLaunchAgent({ argv: ['/bun', '/cli.js', 'serve'], logFile: '/log' });
    expect(plist).toContain('<key>RunAtLoad</key>');
    // `KeepAlive` would restart a server the user stopped on purpose.
    expect(plist).not.toContain('<key>KeepAlive</key>');
  });

  test('escapes an argument that would break the XML', () => {
    const plist = renderLaunchAgent({ argv: ['/opt/a&b/<c>.js'], logFile: '/log' });
    expect(plist).toContain('<string>/opt/a&amp;b/&lt;c&gt;.js</string>');
  });
});

describe('renderDesktopEntry', () => {
  test('quotes a path containing a space and leaves a plain one alone', () => {
    const entry = renderDesktopEntry({ argv: ['/usr/bin/bun', '/home/a b/cli.js', 'serve'], port: 3000 });
    expect(entry).toContain('Exec=/usr/bin/bun "/home/a b/cli.js" serve');
    expect(entry).toContain('X-GNOME-Autostart-enabled=true');
  });
});

describe('renderWindowsRunValue', () => {
  test('quotes only the arguments that need it', () => {
    const value = renderWindowsRunValue(['C:\\a b\\bun.exe', 'C:\\c\\cli.js', 'serve']);
    expect(value).toBe('"C:\\a b\\bun.exe" C:\\c\\cli.js serve');
  });
});

describe('trayUrl', () => {
  test('resolves a bind-any address to loopback, and keeps the scheme', () => {
    expect(trayUrl(3000, '0.0.0.0', false)).toBe('http://127.0.0.1:3000');
    expect(trayUrl(3000, '127.0.0.1', true)).toBe('https://127.0.0.1:3000');
    // A `--tls` server answers nothing on HTTP, so the scheme has to be carried.
    expect(trayUrl(3000, 'localhost', true)).toBe('https://127.0.0.1:3000');
  });
});

describe('buildTrayConfig', () => {
  test('resolves the CLI entry without a `..` segment in it', () => {
    const config = buildTrayConfig({
      pkgRoot: process.cwd(),
      port: 3999,
      host: '127.0.0.1',
      tls: false,
      dataDir: '/data',
      bun: '/bun',
      icon: join(process.cwd(), 'public', 'icon-192x192.png'),
      pidFile: '/data/tray/host/tray-3999.pid',
      loginInstalled: false,
    });
    expect(config.cli).toContain(join('src', 'cli', 'ompchamber.js'));
    expect(config.cli).not.toContain('..');
    expect(config.url).toBe('http://127.0.0.1:3999');
    expect(config.logFile).toBe('/data/logs/ompchamber-3999.log');
    expect(config.loginInstalled).toBe(false);
  });
});

describe('linux host menu', () => {
  const config = { loginInstalled: false, url: 'http://127.0.0.1:3999', logFile: '/log' };

  test('the login row names the way it will go', () => {
    const off = buildMenuModel(config).find((row) => row.id === 'login');
    expect(off?.title).toBe('Start at Login');
    const on = buildMenuModel({ ...config, loginInstalled: true }).find((row) => row.id === 'login');
    expect(on?.title).toBe('Disable Start at Login');
  });

  // yad and zenity split the menu on `!` and `|`, so a label carrying either
  // would silently truncate the row.
  test('a label cannot break the menu separators', () => {
    const payload = menuPayload([{ id: 'login', title: 'Start | Stop!Server' }, { separator: true }, { id: 'quit', title: 'Quit Kabmo' }]);
    const parts = payload.split('|');
    expect(parts[0]).toContain('Start   Stop Server!action:login');
    expect(parts[2]).toContain('Quit Kabmo!action:quit');
  });
});

describe('autostart filesystem round trip', () => {
  // Exercised against a temp HOME: the real install was verified separately, and
  // a test that wrote into the developer's own LaunchAgents would be a test that
  // installed something on every run.
  test('writes, reports and removes an entry', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ompchamber-autostart-'));
    const before = process.env.HOME;
    process.env.HOME = home;
    try {
      expect(isAutostartInstalled({ platform: 'linux' })).toBe(false);
      const written = installAutostart({
        platform: 'linux',
        argv: ['/bun', '/cli.js', 'serve', '--foreground'],
        port: 3999,
        logFile: `${home}/data/tray.log`,
      });
      expect(written.path).toContain('autostart');
      expect(isAutostartInstalled({ platform: 'linux' })).toBe(true);
      const content = await readFile(written.path as string, 'utf8');
      expect(content).toContain('Exec=/bun /cli.js serve --foreground');
      expect(uninstallAutostart({ platform: 'linux' })).toBe(true);
      expect(isAutostartInstalled({ platform: 'linux' })).toBe(false);
    } finally {
      if (before === undefined) delete process.env.HOME;
      else process.env.HOME = before;
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe('the login entry carries a credential PATH, never the secret', () => {
  const base = { bun: '/bun', cli: '/pkg/src/cli/ompchamber.js', port: 3000, host: '127.0.0.1', tray: true, tls: false, lan: false };

  // A plist is mode 0644 and outlives the run that wrote it, so a password in
  // its argv is published to every user on the machine — measured: the value
  // appeared verbatim in the CLI's own `ps` line. The entry therefore names a
  // FILE (0600, beside auth.json) and the CLI reads it on the way in.
  test('names the credential file when the registering run had a password', () => {
    const argv = buildLoginEntryArgv({ ...base, credentialPath: '/data/autostart-credential' });
    expect(argv).toContain('--ui-password-file');
    expect(argv[argv.indexOf('--ui-password-file') + 1]).toBe('/data/autostart-credential');
    // The secret itself must not be representable here at all.
    expect(argv.some((value) => value === '--ui-password')).toBe(false);
  });

  test('omits the flag when there is no stored credential', () => {
    expect(buildLoginEntryArgv(base)).not.toContain('--ui-password-file');
    expect(buildLoginEntryArgv({ ...base, credentialPath: null })).not.toContain('--ui-password-file');
  });
});
