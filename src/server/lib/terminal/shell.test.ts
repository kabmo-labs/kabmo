/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, test } from 'bun:test';

import {
  resolveShellExecutable,
  shellArgs,
  shellCandidates,
  shellLaunch,
  terminalEnv,
} from '@/server/lib/terminal/shell';

describe('shellCandidates', () => {
  test('prefers an absolute $SHELL over the platform defaults', () => {
    expect(shellCandidates({ SHELL: '/opt/homebrew/bin/fish' }, 'darwin')[0]).toBe('/opt/homebrew/bin/fish');
  });

  test('ignores a relative $SHELL so PATH cannot choose the login shell', () => {
    expect(shellCandidates({ SHELL: 'fish' }, 'darwin')).toEqual(['/bin/zsh', '/bin/bash', '/bin/sh']);
  });

  test('falls back to the platform defaults without $SHELL', () => {
    expect(shellCandidates({}, 'linux')).toEqual(['/bin/zsh', '/bin/bash', '/bin/sh']);
  });

  test('uses COMSPEC on windows', () => {
    expect(shellCandidates({ COMSPEC: 'C:\\Windows\\System32\\cmd.exe' }, 'win32')).toEqual([
      'C:\\Windows\\System32\\cmd.exe',
    ]);
  });
});

describe('shellArgs', () => {
  test('POSIX shells launch interactive and login', () => {
    // Interactive is what enables job control; without it Ctrl+Z/`fg` are dead.
    expect(shellArgs('darwin')).toEqual(['-i', '-l']);
  });

  test('cmd.exe takes neither flag', () => {
    expect(shellArgs('win32')).toEqual([]);
  });
});

describe('shellLaunch', () => {
  test('re-acquires the controlling terminal before exec on POSIX', () => {
    // Without this, a detached child has no controlling tty and the shell
    // silently disables job control.
    const argv = shellLaunch('/bin/zsh', 'darwin');
    expect(argv[0]).toBe('/bin/sh');
    expect(argv[1]).toBe('-c');
    expect(argv[2]).toContain('exec /bin/zsh -i -l');
    // `exec` matters: it keeps the pid, so the shell stays the session leader
    // and a group signal still reaches everything it starts.
    expect(argv[2].match(/exec /g)?.length).toBe(2);
  });

  test('re-acquires the terminal through /dev/fd/0, guarded by [ -t 0 ]', () => {
    // `/dev/tty` resolves through the child's CONTROLLING terminal, which a
    // `setsid()` child does not have: on Linux the open fails with ENXIO while
    // macOS tolerates it, so the shim died before the shell started and every
    // terminal test timed out on CI. `/dev/fd/0` is the PTY the parent already
    // wired up and resolves on both.
    const script = shellLaunch('/bin/zsh', 'darwin')[2];
    expect(script).toContain('</dev/fd/0');
    expect(script).not.toContain('/dev/tty');
    // The device nodes are no test at all — both always exist — so the guard
    // has to ask whether stdin is a terminal. A device-node guard takes the
    // redirect branch on a child with no terminal, and the failing redirect
    // then kills the shim (dash exits 2) with the fallback never reached.
    expect(script).toContain('if [ -t 0 ]; then');
    expect(script).not.toContain('-c /dev/fd/0');
    // A shell with no terminal still starts, unredirected: job control is lost,
    // the terminal is not.
    expect(script.endsWith('exec /bin/zsh -i -l')).toBe(true);
  });

  test('runs the shell directly on windows', () => {
    expect(shellLaunch('cmd.exe', 'win32')).toEqual(['cmd.exe']);
  });
});

describe('terminalEnv', () => {
  test('describes the renderer and theme to the child', () => {
    const env = terminalEnv({ PATH: '/usr/bin', COLORFGBG: 'stale' }, 'light');
    expect(env.TERM).toBe('xterm-256color');
    expect(env.COLORTERM).toBe('truecolor');
    expect(env.COLORFGBG).toBe('0;15');
    expect(env.PATH).toBe('/usr/bin');
  });

  test('drops the chamber IPC descriptor', () => {
    // An inherited NODE_CHANNEL_FD makes Node CLIs print IPC parse errors.
    const env = terminalEnv({ NODE_CHANNEL_FD: '3' }, 'dark');
    expect('NODE_CHANNEL_FD' in env).toBe(false);
    expect(env.COLORFGBG).toBe('15;0');
  });

  test('the chamber host env does not reach the shell', () => {
    // Measured before this: a PTY under a chamber serving 3001 reported
    // `PORT=3001 NODE_ENV=production`, so `bun run dev` typed into the terminal
    // panel failed with "Port 3001 is already served by OMPChamber" while the
    // same command in a plain terminal ran on 3000.
    const env = terminalEnv({ PATH: '/usr/bin', PORT: '3001', NODE_ENV: 'production', NEXT_PUBLIC_X: '1' }, 'dark');
    expect('PORT' in env).toBe(false);
    expect('NODE_ENV' in env).toBe(false);
    expect('NEXT_PUBLIC_X' in env).toBe(false);
    // The rest of the environment still passes through, or the shell loses PATH.
    expect(env.PATH).toBe('/usr/bin');
  });
});

describe('resolveShellExecutable', () => {
  test('returns the first candidate that exists', async () => {
    const checked: string[] = [];
    const resolved = await resolveShellExecutable(['/nope/zsh', '/bin/bash'], async (target) => {
      checked.push(target);
      return target === '/bin/bash';
    });
    expect(resolved).toBe('/bin/bash');
    expect(checked).toEqual(['/nope/zsh', '/bin/bash']);
  });

  test('reports no shell when nothing exists', async () => {
    expect(await resolveShellExecutable(['/nope'], async () => false)).toBeNull();
  });
});
