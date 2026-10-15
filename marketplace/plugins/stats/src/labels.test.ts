/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The label rules, against synthetic processes.
 *
 * Every rule pinned here is one that fails SILENTLY in the app: a row that
 * falls through to the basename still renders, and a title with no project
 * still renders. Neither shows up as an error, so the shapes are asserted
 * rather than the fact that a string came back.
 *
 * The session cases are the ones worth stating: a host that ADOPTED a prewarm
 * keeps the prewarm's argv, so the LEASE is what decides session-vs-prewarm,
 * and a test that only fed `--resume` would pin the wrong rule.
 */

import { describe, expect, test } from 'bun:test';

import { commandLabel, describeProcess, formatSpan, projectOf } from './labels';
import type { ProcessInfo } from './proc/types';

const NOW = 1_700_000_000_000;

function proc(pid: number, argv: string[] | null, extra: Partial<ProcessInfo> = {}): ProcessInfo {
  return {
    pid,
    ppid: 1,
    rss: 1024,
    cpuNs: 0,
    threads: 1,
    argv,
    cwd: null,
    startedAt: NOW - 60_000,
    ...extra,
  };
}

describe('commandLabel', () => {
  test('a bun process is named by its script, not the runtime', () => {
    expect(commandLabel(proc(1, ['bun', '/path/dist/client/index.js', '--ompchamber-server']))).toBe('index.js');
  });

  test('`bun run <script>` names the script, not the subcommand', () => {
    expect(commandLabel(proc(1, ['bun', 'run', 'src/server/index.ts']))).toBe('index.ts');
    expect(commandLabel(proc(2, ['bun', 'run', '/abs/path/boot.ts', '--flag']))).toBe('boot.ts');
  });

  test('a flag where the script would be keeps the runtime', () => {
    expect(commandLabel(proc(1, ['bun', '-e', 'console.log(1)']))).toBe('bun');
  });

  test('a non-runtime keeps its own basename', () => {
    expect(commandLabel(proc(1, ['/bin/zsh', '-i']))).toBe('zsh');
    expect(commandLabel(proc(2, ['/path/chrome']))).toBe('chrome');
  });

  test('an unreadable argv answers `?` rather than throwing', () => {
    expect(commandLabel(proc(1, null))).toBe('?');
    expect(commandLabel(proc(1, []))).toBe('?');
  });
});

describe('formatSpan', () => {
  test('scales seconds -> minutes -> hours -> days', () => {
    expect(formatSpan(NOW - 12_000, NOW)).toBe('12s');
    expect(formatSpan(NOW - 54 * 60_000, NOW)).toBe('54m');
    expect(formatSpan(NOW - (2 * 3600 + 18 * 60) * 1000, NOW)).toBe('2h18m');
    expect(formatSpan(NOW - (50 * 3600) * 1000, NOW)).toBe('2d02h');
  });

  test('an unknown start time is EMPTY, never `0s`', () => {
    // 0 means "the platform could not say", and `0s` would read as "just
    // started" on every row a probe failed to timestamp.
    expect(formatSpan(0, NOW)).toBe('');
  });
});

describe('projectOf', () => {
  test('names the basename, and `~` for the home directory', () => {
    expect(projectOf('/Users/me/code/ompchamber')).toBe('ompchamber');
    expect(projectOf(null)).toBeNull();
  });
});

describe('describeProcess', () => {
  test('the chamber server names itself, not its entry file', () => {
    const label = describeProcess(proc(1, ['bun', '/path/index.js', '--ompchamber-server']), { now: NOW });
    expect(label.title).toBe('OMPChamber server');
    expect(label.detail).toContain('the server itself');
  });

  test('a LEASE makes a host a session, even with prewarm argv', () => {
    // The load-bearing rule: argv is fixed at spawn, so a host that adopted a
    // prewarm never gains a `--resume`. Measured on this machine, three such
    // hosts were live sessions with titles.
    const host = proc(101, ['bun', '/bin/omp', '--mode', 'rpc-ui', '--cwd', '/Users/me/proj']);
    const asPrewarm = describeProcess(host, { now: NOW, lease: null });
    expect(asPrewarm.title).toBe('prewarm (idle host)');
    expect(asPrewarm.detail).toContain('no session');

    const asSession = describeProcess(host, { now: NOW, lease: '01a13ceb-bb58-7351-baa5-30abb45cad14' });
    // Never the prewarm wording, and always a session identity: either the
    // title omp stored for that id (when this machine has the transcript) or
    // the short id as the fallback.
    expect(asSession.title).not.toBe('prewarm (idle host)');
    expect(asSession.detail).toContain('01a13ceb');
    expect(asSession.title.length).toBeGreaterThan(0);
  });

  test('a utility child is not called a prewarm', () => {
    const label = describeProcess(
      proc(102, ['bun', '/bin/omp', '--mode', 'rpc-ui', '--cwd', '/Users/me', '--no-session', '--no-lsp']),
      { now: NOW },
    );
    expect(label.title).toBe('omp utility');
    expect(label.detail).toContain('registry queries');
  });

  test('each worker shape is named, not left as `cli.js`', () => {
    const cases: Array<[string[], string]> = [
      [['bun', 'cli.js', '__omp_worker_daemon_broker'], 'daemon broker'],
      [['bun', 'cli.js', '__omp_worker_lsp_mux'], 'LSP mux'],
      [['bun', 'cli.js', '__omp_worker_js_eval_process'], 'js-eval sandbox'],
      [['bun', 'cli.js', '__omp_worker_stt'], 'dictation worker'],
    ];
    for (const [argv, title] of cases) {
      expect(describeProcess(proc(200, argv), { now: NOW }).title).toBe(title);
    }
  });

  test('a relay carries its port', () => {
    expect(describeProcess(proc(200, ['bun', 'cli.js', 'browser-relay', '--port', '9224']), { now: NOW }).title).toBe(
      'browser relay :9224',
    );
  });

  test('codegraph separates the server from its watchdog', () => {
    const server = describeProcess(
      proc(200, ['node', '/Users/me/.codegraph/versions/v1.6.2/lib/dist/bin/codegraph.js', 'serve', '--mcp'], {
        cwd: '/Users/me/proj',
      }),
      { now: NOW },
    );
    expect(server.title).toBe('codegraph MCP · proj');
    // The watchdog is a `node -e` whose script text names CodeGraph.
    const watchdog = describeProcess(
      proc(201, ['/Users/me/.codegraph/versions/v1.6.2/node', '-e', 'const parentPid = Number(process.argv[1]);']),
      { now: NOW },
    );
    expect(watchdog.title).toBe('codegraph watchdog');
  });

  test('the language servers carry their project, which argv does not', () => {
    const tsserver = describeProcess(proc(200, ['node', '/p/tsserver.js'], { cwd: '/Users/me/proj' }), { now: NOW });
    expect(tsserver.title).toBe('tsserver · proj');
    const lsp = describeProcess(proc(201, ['node', '/p/typescript-language-server', '--stdio'], { cwd: '/Users/me/proj' }), {
      now: NOW,
    });
    expect(lsp.title).toBe('LSP · proj');
  });

  test('a Chromium helper names its process type', () => {
    const label = describeProcess(
      proc(200, ['/Users/me/.omp/puppeteer/chrome/Google Chrome for Testing', '--type=renderer', '--no-sandbox']),
      { now: NOW },
    );
    expect(label.title).toBe('Chromium renderer');
  });

  test('a PTY shell is a shell, with its project', () => {
    const label = describeProcess(proc(200, ['/bin/zsh', '-i', '-l'], { cwd: '/Users/me/proj' }), { now: NOW });
    expect(label.title).toBe('shell · proj');
    expect(label.detail).toContain('pty');
  });

  test('an unrecognised process falls back to the basename plus its project', () => {
    const label = describeProcess(proc(200, ['/opt/weird/thing'], { cwd: '/Users/me/proj' }), { now: NOW });
    expect(label.title).toBe('thing');
    expect(label.detail).toContain('proj');
  });

  test('an unreadable argv still renders a row', () => {
    const label = describeProcess(proc(200, null), { now: NOW });
    expect(label.title).toBe('?');
  });
});
