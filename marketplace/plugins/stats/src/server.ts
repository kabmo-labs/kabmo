/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Stats plugin's SERVER half.
 *
 * The sampling loop, the process probes and the classification all live here
 * rather than in the app bundle, and that is not an architectural preference:
 * a browser cannot read another process's RSS or CPU at all. The panel is a
 * reader of what this half measures.
 *
 * ## The loop only runs while somebody is watching
 *
 * `api.background.service` is started by the host at load and disposed with the
 * plugin, which is exactly one interval per loaded plugin — but the sampler
 * inside it is armed only while a `stats` panel is open. The RPC method `watch`
 * is what arms it, `unwatch` disarms it, and the service's tick is a no-op with
 * no watchers. A background sampler walking the process table every second for a
 * panel nobody has open is the cost this avoids.
 *
 * ## What the panel reads
 *
 * The topic (`api.realtime`) carries the latest snapshot, so the panel renders
 * what the server measured rather than asking on a timer. The HTTP route is the
 * first paint and the user's own Refresh, and `?refresh=1` forces a sample
 * immediately instead of waiting for the next tick.
 *
 * Every member of the API is exercised deliberately — a service, a schedule, two
 * RPC methods, an HTTP route, a topic, an event and settings — so a change that
 * breaks one of them is visible in this plugin rather than in a user's.
 */

import type { ChamberPluginApi, PluginJson } from '@ompchamber/plugin-sdk';

import { createSampler, type StatsSnapshot } from './sampler';
import { readDaemonRegistry } from './daemons';

/** The tick's floor: below this a CPU delta is noise against the clock. */
const MIN_SAMPLE_MS = 200;

/**
 * A snapshot as the wire carries it.
 *
 * `PluginJson` is an index-signature type, so an interface — even one built
 * entirely from strings, numbers and plain objects — is not assignable to it
 * without an assertion. The payload is constructed here and nowhere else, so
 * the assertion is the honest one: the alternative is a JSON round-trip per
 * sample to re-derive a shape that is already known.
 */
function asJson(snapshot: StatsSnapshot): PluginJson {
  return snapshot as unknown as PluginJson;
}

export default function plugin(api: ChamberPluginApi) {
  api.log.info('stats server half loaded');

  /** How many panels are watching. The loop samples only while this is > 0. */
  let watchers = 0;
  /** The latest snapshot, so a subscriber that arrives between ticks has one. */
  let latest: StatsSnapshot | null = null;
  /**
   * Ends the sampling loop.
   *
   * The loop is stopped from `onDispose` rather than from the service's `stop`
   * because it must not depend on the host calling one: `background.service`'s
   * `stop` is recorded by the host and, as of this writing, never invoked (the
   * loaded plugin's `background` handle is stored and read by nothing — see the
   * note in `docs/stats-plugin.md`). A loop that only ended on `stop` would
   * outlive every reload. This is self-contained and correct either way.
   */
  const abort = new AbortController();
  let sampler = createSampler({
    serverPid: process.pid,
    now: () => Date.now(),
  });

  async function readSampleMs(): Promise<number> {
    const configured = await api.settings.readOne<number>('sampleMs');
    const value = typeof configured === 'number' && Number.isFinite(configured) ? configured : 1000;
    return Math.max(MIN_SAMPLE_MS, value);
  }

  /** Rebuild the sampler from the current settings — a change applies at once. */
  async function rebuildSampler(): Promise<void> {
    const [includeDaemons, historyPoints] = await Promise.all([
      api.settings.readOne<boolean>('includeBrokers'),
      api.settings.readOne<number>('historyPoints'),
    ]);
    sampler = createSampler({
      serverPid: process.pid,
      now: () => Date.now(),
      includeDaemons: includeDaemons !== false,
      historyPoints: typeof historyPoints === 'number' && Number.isFinite(historyPoints) ? historyPoints : 60,
    });
    latest = null;
  }

  /** Take one sample and publish it. The only writer of the topic. */
  function sampleAndPublish(): StatsSnapshot {
    try {
      latest = sampler.sample();
      api.realtime.publish(asJson(latest));
      return latest;
    } catch (error) {
      // A probe failure is reported as a snapshot with the reason, not as a
      // silent gap: an empty table with no explanation reads as "nothing runs".
      const reason = error instanceof Error ? error.message : String(error);
      api.log.error('sampling failed', reason);
      const failure: StatsSnapshot = {
        sampledAt: Date.now(),
        probe: { name: 'unknown', supported: false, reason },
        rows: [],
        groups: [],
        total: { processes: 0, rss: 0, cpuPercent: 0 },
        machine: {
          totalMemBytes: 0,
          freeMemBytes: 0,
          cpuCount: 0,
          loadPerCore: 0,
        },
        daemons: [],
        serverPid: process.pid,
        error: reason,
      };
      latest = failure;
      api.realtime.publish(asJson(failure));
      return failure;
    }
  }

  api.realtime.seed(
    asJson({
      sampledAt: 0,
      probe: { name: 'pending', supported: true },
      rows: [],
      groups: [],
      total: { processes: 0, rss: 0, cpuPercent: 0 },
      machine: { totalMemBytes: 0, freeMemBytes: 0, cpuCount: 0, loadPerCore: 0 },
      daemons: [],
      serverPid: process.pid,
    }),
  );

  /**
   * The sampling loop.
   *
   * A `service` rather than a `schedule`: a schedule is a cron/interval spec the
   * host fires, while this must tick on a cadence the user can change and must
   * stop when the plugin is disposed. The interval is re-read on every tick, so
   * a settings change takes effect without a reload.
   */
  api.background.service('sampler', {
    start() {
      void (async () => {
        while (!abort.signal.aborted) {
          const waitMs = await readSampleMs();
          // The wait is raced against the abort, so disposal ends the loop
          // immediately rather than after the current interval — a sleeping
          // second per tick is a second of a disposed plugin still holding a
          // timer, and a reload would accumulate one per generation.
          const { promise, resolve } = Promise.withResolvers<void>();
          const timer = setTimeout(resolve, waitMs);
          abort.signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
          await promise;
          if (abort.signal.aborted) return;
          if (watchers > 0) sampleAndPublish();
        }
      })();
    },
  });

  /**
   * A one-shot daemon sweep per hour, so the registry is not re-read on every
   * tick. The daemons themselves are read inside `sample()`; this exists to
   * prove the schedule surface and to keep the panel's daemon list fresh on a
   * machine where a daemon is started by something else.
   */
  api.background.schedule('daemon-refresh', '1h', () => {
    const daemons = readDaemonRegistry();
    api.log.debug('daemon registry refreshed', daemons.length);
    api.events.emit('daemons-refreshed', daemons.length);
  });

  /** Arm the loop for one panel. */
  api.rpc.register<undefined, { watching: number }>('watch', {
    handler: () => {
      watchers += 1;
      // Answer the first sample immediately: waiting a full interval for the
      // first paint would show an empty panel for a second on every open.
      if (!latest) sampleAndPublish();
      return { watching: watchers };
    },
  });

  /** Disarm one panel's watch. Idempotent per caller by construction — a panel
   *  that unmounts without unwatching leaves the loop armed, which is why the
   *  app half unsubscribes on unmount. */
  api.rpc.register<undefined, { watching: number }>('unwatch', {
    handler: () => {
      watchers = Math.max(0, watchers - 1);
      return { watching: watchers };
    },
  });

  /** The current snapshot, or a fresh one when none has been taken. */
  api.rpc.register<{ force?: boolean }, StatsSnapshot>('snapshot', {
    handler: ({ force } = {}) => {
      if (force || !latest) return sampleAndPublish();
      return latest;
    },
  });

  /**
   * The HTTP surface: a first paint for anything that is not the panel, and the
   * shape a `curl` or a monitor can read.
   *
   * `?refresh=1` forces a sample — the panel's own Refresh uses it, because a
   * cached snapshot up to a second old is not what a user pressing Refresh is
   * asking for.
   */
  api.http.route('/snapshot', (request) => {
    const url = new URL(request.url);
    const force = url.searchParams.get('refresh') === '1';
    const snapshot = force || !latest ? sampleAndPublish() : latest;
    return Response.json(snapshot);
  });

  // A settings change applies on the next tick: the sampler is rebuilt so a
  // changed history length or daemon setting takes effect without a reload.
  api.settings.subscribe(() => {
    void rebuildSampler().catch((error) => {
      api.log.error('rebuilding the sampler failed', error instanceof Error ? error.message : String(error));
    });
  });

  api.onDispose(() => {
    // Ends the loop whether or not the host ever calls the service's `stop`.
    abort.abort();
    watchers = 0;
    latest = null;
    api.log.info('stats server half disposed');
  });
}
