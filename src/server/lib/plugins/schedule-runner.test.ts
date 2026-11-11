/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The plugin schedule clock.
 *
 * The bug this pins: `api.background.schedule()` recorded a schedule and
 * nothing ever read it, so the bundled `session-info` (`5m`) and `stats` (`1h`)
 * schedules were inert. These tests drive the runner over a fake loaded-plugin
 * map, which is the same seam the boot uses.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import type { LoadedPlugin } from '@/server/lib/plugins/loader.server';
import type { PluginSchedule } from '@/server/lib/plugins/background.server';
import {
  startPluginScheduleRuntime,
  stopPluginScheduleRuntime,
  tickPluginSchedules,
} from '@/server/lib/plugins/schedule-runner.server';

function schedule(overrides: Partial<PluginSchedule> = {}): PluginSchedule {
  return {
    pluginId: 'alpha',
    id: 'refresh',
    kind: 'every',
    spec: '5m',
    run: () => {},
    nextRunAt: 1_000,
    ...overrides,
  };
}

function host(pluginId: string, schedules: PluginSchedule[]): LoadedPlugin {
  return {
    pluginId,
    api: {} as LoadedPlugin['api'],
    background: { services: [], schedules },
    disposers: [],
  };
}

function install(plugins: LoadedPlugin[]): void {
  globalThis.__kabmoLoadedPlugins = new Map(plugins.map((plugin) => [plugin.pluginId, plugin]));
}

afterEach(() => {
  stopPluginScheduleRuntime();
  globalThis.__kabmoLoadedPlugins = undefined;
});

describe('tickPluginSchedules', () => {
  test('runs a due schedule and advances it past the fire', async () => {
    const runs: number[] = [];
    const entry = schedule({ run: () => void runs.push(1) });
    install([host('alpha', [entry])]);

    expect(await tickPluginSchedules(1_000)).toBe(1);
    expect(runs).toHaveLength(1);
    expect(entry.nextRunAt).toBeGreaterThan(1_000);
  });

  test('leaves a schedule that is not due alone', async () => {
    const runs: number[] = [];
    const entry = schedule({ nextRunAt: 10_000, run: () => void runs.push(1) });
    install([host('alpha', [entry])]);

    expect(await tickPluginSchedules(1_000)).toBe(0);
    expect(runs).toHaveLength(0);
    expect(entry.nextRunAt).toBe(10_000);
  });

  test('a throwing run is reported and the schedule still advances', async () => {
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args.map(String).join(' '));
    const entry = schedule({
      run: () => {
        throw new Error('boom');
      },
    });
    install([host('alpha', [entry])]);
    try {
      expect(await tickPluginSchedules(1_000)).toBe(1);
    } finally {
      console.error = original;
    }
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('alpha');
    expect(errors[0]).toContain('refresh');
    expect(errors[0]).toContain('boom');
    expect(entry.nextRunAt).toBeGreaterThan(1_000);
  });

  test('a schedule with no next fire is parked instead of spinning', async () => {
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args.map(String).join(' '));
    // 31 February never matches, so `nextRunAfter` answers null.
    const entry = schedule({ kind: 'cron', spec: '0 0 31 2 *' });
    install([host('alpha', [entry])]);
    try {
      await tickPluginSchedules(1_000);
    } finally {
      console.error = original;
    }
    expect(entry.nextRunAt).toBe(Number.POSITIVE_INFINITY);
    expect(errors[0]).toContain('no next fire');
  });

  test('every loaded plugin is visited, not just the first', async () => {
    const runs: string[] = [];
    install([
      host('alpha', [schedule({ run: () => void runs.push('alpha') })]),
      host('beta', [schedule({ pluginId: 'beta', run: () => void runs.push('beta') })]),
    ]);
    expect(await tickPluginSchedules(1_000)).toBe(2);
    expect(runs).toEqual(['alpha', 'beta']);
  });
});

describe('startPluginScheduleRuntime', () => {
  test('is idempotent and stops cleanly', () => {
    startPluginScheduleRuntime();
    startPluginScheduleRuntime();
    stopPluginScheduleRuntime();
    stopPluginScheduleRuntime();
  });
});
