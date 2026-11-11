/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The clock behind `api.background.schedule()`.
 *
 * `createPluginBackground` only RECORDS a schedule; this module is the one
 * consumer of `LoadedPlugin.background.schedules`. Without it a declared
 * schedule was inert — measured: the bundled `session-info` (`5m`) and `stats`
 * (`1h`) schedules never fired, so a plugin author's only working background
 * option was `service()`, which starts at declaration and therefore cannot be
 * periodic without owning a timer the host cannot see.
 *
 * Serial on purpose, the same rule the scheduled-task runtime follows: a tick
 * runs one due schedule at a time, so a burst cannot start ten jobs against the
 * same CPU. A run that throws is reported under the plugin's own name and the
 * schedule still advances — a permanently failing schedule must not spin.
 *
 * The state is anchored on `globalThis` because `bun --hot` re-evaluates this
 * module while the interval it started is still live; a module-level handle
 * would come back null and the next start would leave a second ticker running.
 */

import { advancePluginSchedule, type PluginSchedule } from '@/server/lib/plugins/background.server';
import { loadedPlugins } from '@/server/lib/plugins/loader.server';

/** How often the clock looks for due schedules. The grammar's floor is 1m. */
export const PLUGIN_SCHEDULE_TICK_MS = 15_000;
/** The first look, after the boot's plugin pass has registered its schedules. */
export const PLUGIN_SCHEDULE_FIRST_TICK_MS = 5_000;

interface RunnerState {
  timer: NodeJS.Timeout | null;
  ticking: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoPluginScheduleRunner: RunnerState | undefined;
}

function state(): RunnerState {
  return (globalThis.__kabmoPluginScheduleRunner ??= { timer: null, ticking: false });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One pass: run every schedule whose fire time has arrived, then advance it.
 *
 * Exported for tests and for a manual tick; the interval below is the only
 * production caller. Returns how many schedules ran.
 */
export async function tickPluginSchedules(now = Date.now()): Promise<number> {
  let ran = 0;
  for (const record of loadedPlugins()) {
    for (const schedule of record.background.schedules) {
      if (schedule.nextRunAt > now) continue;
      ran += 1;
      await runOne(record.pluginId, schedule);
    }
  }
  return ran;
}

async function runOne(pluginId: string, schedule: PluginSchedule): Promise<void> {
  try {
    await schedule.run();
  } catch (error) {
    // A plugin's schedule is plugin code: its failure is reported, never
    // rethrown into the ticker, or one broken schedule stops every other.
    console.error(`[plugins] ${pluginId}: schedule "${schedule.id}" failed — ${message(error)}`);
  }
  const next = advancePluginSchedule(schedule, Date.now());
  if (next === null) {
    // A cron expression that can never match again (a spent date) has no next
    // fire. Parking it at Infinity is honest: the schedule stays listed, and
    // the log says why it stopped.
    schedule.nextRunAt = Number.POSITIVE_INFINITY;
    console.error(`[plugins] ${pluginId}: schedule "${schedule.id}" has no next fire and is stopped`);
    return;
  }
  schedule.nextRunAt = next;
}

/** Start the tick. Idempotent: a second call is a no-op while one is running. */
export function startPluginScheduleRuntime(): void {
  const current = state();
  if (current.timer) return;
  const tick = () => {
    if (current.ticking) return;
    current.ticking = true;
    tickPluginSchedules()
      .catch((error) => console.error('[plugins] schedule tick failed:', error))
      .finally(() => {
        current.ticking = false;
      });
  };
  setTimeout(tick, PLUGIN_SCHEDULE_FIRST_TICK_MS).unref();
  current.timer = setInterval(tick, PLUGIN_SCHEDULE_TICK_MS);
  // A timer must never hold the process open: the listener is what keeps the
  // server alive, and a shutdown must not wait for the next tick.
  current.timer.unref();
}

/** Stop the tick (shutdown, tests). */
export function stopPluginScheduleRuntime(): void {
  const current = state();
  if (current.timer) {
    clearInterval(current.timer);
    current.timer = null;
  }
}
