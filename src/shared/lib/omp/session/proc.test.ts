/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `proc://` parsing and result normalization.
 *
 * The grammar is omp's own (`internal-urls/proc-protocol.ts`): the bare URL
 * lists, `<id>` reads, and only `/kill` and `/mode` are actions. The result
 * shapes below are verbatim `details.proc` bags measured across 298 real calls
 * in the author's session store, plus the legacy top-level `hub` shape omp
 * used before the device existed.
 */

import { describe, expect, test } from 'bun:test';
import {
  bashServiceOf,
  daemonTone,
  formatProcDuration,
  jobTone,
  parseProcUrl,
  procOpLabel,
  procPathOf,
  procUptime,
  procViewOf,
} from '@/shared/lib/omp/session/proc';

describe('parseProcUrl', () => {
  test('reads the bare listing', () => {
    expect(parseProcUrl('proc://')).toEqual({ id: '', action: 'read' });
  });

  test('reads an id', () => {
    expect(parseProcUrl('proc://kabmo-dev')).toEqual({ id: 'kabmo-dev', action: 'read' });
  });

  test('reads the two actions', () => {
    expect(parseProcUrl('proc://kabmo-dev/kill')).toEqual({ id: 'kabmo-dev', action: 'kill' });
    expect(parseProcUrl('proc://kabmo-dev/mode')).toEqual({ id: 'kabmo-dev', action: 'mode' });
  });

  test('ignores a query, a hash and a trailing slash', () => {
    expect(parseProcUrl('proc://bg_1/kill?x=1')).toEqual({ id: 'bg_1', action: 'kill' });
    expect(parseProcUrl('proc://bg_1/#frag')).toEqual({ id: 'bg_1', action: 'read' });
    expect(parseProcUrl('proc://bg_1/kill/')).toEqual({ id: 'bg_1', action: 'kill' });
  });

  test('rejects another scheme', () => {
    expect(parseProcUrl('xd://lsp')).toBeUndefined();
    expect(parseProcUrl('src/x.ts')).toBeUndefined();
    expect(parseProcUrl(undefined)).toBeUndefined();
  });
});

describe('procPathOf', () => {
  test('prefers the result target over the arguments', () => {
    expect(procPathOf({ target: 'proc://a', input: { path: 'proc://b' } })).toBe('proc://a');
  });

  test('falls back to the arguments path', () => {
    expect(procPathOf({ input: { path: 'proc://a' } })).toBe('proc://a');
  });

  test('returns undefined for a file write', () => {
    expect(procPathOf({ target: 'src/x.ts', input: { path: 'src/x.ts' } })).toBeUndefined();
  });
});

describe('procViewOf — write /kill of a service', () => {
  test('reads the op and the daemon snapshot', () => {
    const view = procViewOf({
      target: 'proc://kabmo-dev/kill',
      input: { path: 'proc://kabmo-dev/kill' },
      details: {
        proc: {
          action: 'stop',
          daemon: {
            name: 'kabmo-dev',
            id: '7bf84d40',
            state: 'exited',
            startedAt: 1_791_433_388_038,
            exitedAt: 1_791_434_377_079,
            exitCode: 0,
            restartCount: 0,
            outputBytes: 4540,
            persist: false,
            detached: false,
          },
        },
      },
    });
    expect(view?.op).toBe('stop');
    expect(view?.daemon).toMatchObject({ name: 'kabmo-dev', state: 'exited', exitCode: 0 });
    expect(procUptime(view!.daemon!, 0)?.label).toBe('16m 29s');
  });

  test('reads a stdin payload', () => {
    const view = procViewOf({
      target: 'proc://kabmo-dev',
      details: { proc: { action: 'stdin', daemon: { name: 'kabmo-dev', state: 'ready', pid: 22985 }, input: '{"kill":true}' } },
    });
    expect(view?.op).toBe('stdin');
    expect(view?.input).toBe('{"kill":true}');
    expect(view?.daemon?.pid).toBe(22985);
  });

  test('reads a mode write', () => {
    const view = procViewOf({
      target: 'proc://kabmo-3599/mode',
      details: { proc: { action: 'mode', daemon: { name: 'kabmo-3599', state: 'ready', persist: true }, mode: 'persist' } },
    });
    expect(view?.op).toBe('mode');
    expect(view?.mode).toBe('persist');
  });
});

describe('procViewOf — read', () => {
  test('reads one service with its log and terminal rows', () => {
    const view = procViewOf({
      target: 'proc://ompdev',
      details: {
        proc: {
          daemon: { name: 'ompdev', state: 'failed', startedAt: 1, exitedAt: 2, exitCode: 1 },
          log: '$ bun run dev\nboom',
          terminalRows: ['$ bun run dev', 'boom'],
        },
      },
    });
    expect(view?.daemon?.state).toBe('failed');
    expect(view?.terminalRows).toEqual(['$ bun run dev', 'boom']);
  });

  test('reads the listing', () => {
    const view = procViewOf({
      target: 'proc://',
      details: {
        proc: {
          jobs: [{ id: 'bg_1', type: 'bash', status: 'running', label: 'bun run probe.ts', durationMs: 1200 }],
          agents: [{ id: 'Sleeper', activity: 'thinking', ageMs: 4200, live: true }],
          daemons: [{ name: 'omp.lsp.mux', state: 'ready', pid: 400 }],
        },
      },
    });
    expect(view?.jobs).toHaveLength(1);
    expect(view?.daemons).toHaveLength(1);
    expect(view?.agents).toHaveLength(1);
    expect(view?.id).toBeUndefined();
  });

  test('reads one background job', () => {
    const view = procViewOf({
      target: 'proc://bg_10',
      details: { proc: { job: { id: 'bg_10', type: 'bash', status: 'running', label: 'probe', durationMs: 147_461 }, log: '' } },
    });
    expect(view?.job?.id).toBe('bg_10');
    expect(view?.daemon).toBeUndefined();
  });

  test('reads a job cancellation', () => {
    const view = procViewOf({
      target: 'proc://bg_2/kill',
      details: {
        proc: {
          op: 'cancel',
          jobs: [{ id: 'bg_2', type: 'bash', status: 'cancelled', label: 'smoke', durationMs: 81_289 }],
          cancelled: [{ id: 'bg_2', status: 'cancelled' }],
        },
      },
    });
    expect(view?.op).toBe('cancel');
    expect(view?.cancelled).toEqual([{ id: 'bg_2', status: 'cancelled' }]);
  });
});

describe('procViewOf — legacy hub shape', () => {
  test('reads a daemon off the top level of details', () => {
    const view = procViewOf({
      target: 'proc://kabmo-dev',
      details: { op: 'start', daemon: { name: 'kabmo-dev', state: 'ready', pid: 22985 } },
    });
    expect(view?.op).toBe('start');
    expect(view?.daemon?.state).toBe('ready');
  });

  test('reads a job list off the top level of details', () => {
    const view = procViewOf({
      details: { op: 'jobs', jobs: [{ id: 'bg_1', status: 'running' }], meta: {} },
    });
    expect(view?.jobs).toHaveLength(1);
  });

  test('returns undefined for an unrelated tool result', () => {
    expect(procViewOf({ target: 'src/x.ts', details: { diff: '+1' } })).toBeUndefined();
  });
});

describe('bashServiceOf', () => {
  test('reads a service launch off a bash result', () => {
    const service = bashServiceOf({ details: { service: { name: 'kabmo-dev', state: 'ready', ready: true, timedOut: false, pid: 22985 } } });
    expect(service).toMatchObject({ name: 'kabmo-dev', state: 'ready', pid: 22985 });
  });

  test('returns undefined for a plain command', () => {
    expect(bashServiceOf({ details: { exitCode: 0 } })).toBeUndefined();
  });
});

describe('tones and durations', () => {
  test('maps daemon states', () => {
    expect(daemonTone('ready')).toBe('ok');
    expect(daemonTone('running')).toBe('ok');
    expect(daemonTone('failed')).toBe('error');
    expect(daemonTone('starting')).toBe('warn');
    expect(daemonTone('exited')).toBe('muted');
    expect(daemonTone(undefined)).toBe('muted');
  });

  test('maps job statuses', () => {
    expect(jobTone('completed')).toBe('ok');
    expect(jobTone('failed')).toBe('error');
    expect(jobTone('cancelled')).toBe('warn');
    expect(jobTone('running')).toBe('muted');
  });

  test('formats a duration at each scale', () => {
    expect(formatProcDuration(840)).toBe('840ms');
    expect(formatProcDuration(45_000)).toBe('45s');
    expect(formatProcDuration(123_000)).toBe('2m 3s');
    expect(formatProcDuration(3_930_000)).toBe('1h 5m');
  });

  test('an exited service reports the span it RAN, not the time since it started', () => {
    const uptime = procUptime({ startedAt: 1000, exitedAt: 2000 }, 999_999);
    expect(uptime?.ms).toBe(1000);
    expect(uptime?.label).toBe('1s');
  });

  test('a live service reports the time since it started', () => {
    expect(procUptime({ startedAt: 1000 }, 5000)?.ms).toBe(4000);
  });

  test('no start time means no uptime', () => {
    expect(procUptime({})).toBeUndefined();
  });

  test('labels each op', () => {
    expect(procOpLabel('stop')).toBe('stop');
    expect(procOpLabel('kill')).toBe('stop');
    expect(procOpLabel('stdin')).toBe('stdin');
    expect(procOpLabel('mode')).toBe('mode');
    expect(procOpLabel('cancel')).toBe('cancel');
    expect(procOpLabel('list')).toBe('list');
    expect(procOpLabel('read')).toBe('list');
  });
});
