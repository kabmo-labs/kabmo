/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A plugin's background work: long-lived services and scheduled runs.
 *
 * Both members only RECORD what the plugin wants; the loader starts it and the
 * disposal pass stops it. That split is what makes a service survive a reload
 * exactly once instead of once per reload, and it is the only reason
 * `onDispose` can be trusted to have nothing left to clean up.
 *
 * The schedule grammar is the CHAMBER's (`@/shared/lib/schedule/parse`), not a
 * second parser: a plugin's `5m` and a scheduled task's `5m` must mean the same
 * thing, and the day-of-week rule is the kind of thing two implementations get
 * subtly different. A spec that parses as neither is refused at declaration
 * with the reason, because a silently-never-firing timer is the worst outcome.
 */

import { parseCron, parseInterval, nextRunAfter, validateSchedule } from '@/shared/lib/schedule/parse';
import type { ScheduleKind } from '@/shared/types/schedule';
import type { PluginBackgroundApi } from '@kabmo-labs/plugin-sdk';

/** One declared service, with the plugin it belongs to. */
export interface PluginService {
  pluginId: string;
  id: string;
  stop?: () => void | Promise<void>;
}

/** One declared schedule, with the fire time already resolved. */
export interface PluginSchedule {
  pluginId: string;
  id: string;
  kind: ScheduleKind;
  spec: string;
  run: () => void | Promise<void>;
  /** The next fire, advanced by the runner after each run. */
  nextRunAt: number;
}

/** What a declaration produced, so the loader can start and stop it. */
export interface PluginBackgroundHandle {
  services: PluginService[];
  schedules: PluginSchedule[];
}

/**
 * Resolve a plugin's schedule spec to a kind.
 *
 * `once` is deliberately NOT accepted: a plugin declaring a one-shot at load
 * time would fire on every reload, which is a bug the grammar would hide rather
 * than prevent.
 */
function resolveKind(spec: string, now: number): { kind: ScheduleKind; nextRunAt: number } | { error: string } {
  const interval = parseInterval(spec);
  if (interval !== null) {
    const checked = validateSchedule('every', spec, now);
    if (!checked.ok) return { error: checked.error };
    return { kind: 'every', nextRunAt: checked.nextRunAt };
  }
  if (parseCron(spec)) {
    const checked = validateSchedule('cron', spec, now);
    if (!checked.ok) return { error: checked.error };
    return { kind: 'cron', nextRunAt: checked.nextRunAt };
  }
  return { error: `"${spec}" is neither an interval (5m, 1h30m) nor a 5-field cron expression` };
}

/** The API one plugin is handed at load, plus what it declared. */
export function createPluginBackground(pluginId: string, now = Date.now()): {
  api: PluginBackgroundApi;
  handle: PluginBackgroundHandle;
} {
  const handle: PluginBackgroundHandle = { services: [], schedules: [] };
  const api: PluginBackgroundApi = {
    service(id, service) {
      if (typeof service?.start !== 'function') throw new Error(`service "${id}" has no start()`);
      handle.services.push({ pluginId, id, ...(service.stop ? { stop: service.stop } : {}) });
      // The start runs HERE, at declaration: a service that needed the loader to
      // begin would be a service that does not exist for the first tick, and the
      // ordering between "started" and "scheduled" would depend on the loader.
      void service.start();
    },
    schedule(id, spec, run) {
      if (typeof run !== 'function') throw new Error(`schedule "${id}" has no run()`);
      const resolved = resolveKind(spec, now);
      if ('error' in resolved) throw new Error(`schedule "${id}": ${resolved.error}`);
      handle.schedules.push({ pluginId, id, kind: resolved.kind, spec, run, nextRunAt: resolved.nextRunAt });
    },
  };
  return { api, handle };
}

/** Advance one schedule past a fire, using the chamber's own rule. */
export function advancePluginSchedule(schedule: PluginSchedule, after = Date.now()): number | null {
  return nextRunAfter(schedule.kind, schedule.spec, after);
}
