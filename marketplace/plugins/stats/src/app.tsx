/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Stats plugin's app half: a right-panel view of what the omp stack uses.
 *
 * ## It renders what the server measured
 *
 * A browser cannot read another process's RSS or CPU, so every figure here comes
 * from the server half — over the plugin's own realtime topic, which the host
 * pushes on each sample. There is no poll: `useRealtime` re-renders on every
 * push, and `watch`/`unwatch` around the mount is what arms the server's
 * sampler, so closing the panel stops the sampling rather than leaving a loop
 * running for a view nobody is looking at.
 *
 * ## Two states that are not "empty"
 *
 * - **The first sample has no CPU.** A rate needs two readings, so the first
 *   snapshot carries RSS and the process list with a `—` in the CPU column. That
 *   is a real state and the panel says so instead of printing `0.0%`.
 * - **A platform with no probe says so.** Windows has no subprocess-free route
 *   to a foreign process's CPU, and the panel reports that rather than drawing
 *   an empty table that reads as "nothing is running".
 */

import { useEffect, useMemo, useState } from 'preact/hooks';
import { definePluginApp } from '@ompchamber/plugin-sdk/app';
import { usePanelHost, useRealtime, useRpc } from '@ompchamber/ui';
import { Empty, Note, Panel } from '@ompchamber/ui/components';

import { ProcessTable } from './ProcessTable';
import { Sparkline } from './Sparkline';
import { MachineFacts, TotalsBar } from './TotalsBar';
import { formatAge, formatBytes, formatPercent } from './format';
import type { StatsSnapshot } from './sampler';

function StatsPanel() {
  const host = usePanelHost();
  const realtime = useRealtime<StatsSnapshot>();
  const watch = useRpc<undefined, { watching: number }>('watch');
  const unwatch = useRpc<undefined, { watching: number }>('unwatch');
  // The same method the HTTP route's `?refresh=1` uses: it takes a sample NOW
  // instead of waiting for the loop's next tick. The value it answers with is
  // deliberately NOT rendered — the topic is the one source of truth for every
  // subscriber, and the force call publishes to it, so reading the RPC's own
  // reply would put a second copy of the same snapshot on screen.
  const sample = useRpc<{ force?: boolean }, StatsSnapshot>('snapshot');
  const [now, setNow] = useState(() => Date.now());

  // Arm the server's sampler while this panel is on screen, and disarm it on
  // unmount. `active` is the host's own "this is the view being shown" flag, so
  // a panel hidden behind another stops sampling — and a panel that is enabled
  // but not active still renders, which is why the two are checked separately.
  useEffect(() => {
    if (!host.active) return;
    void watch.call(undefined);
    return () => {
      void unwatch.call(undefined);
    };
    // `call` is stable per method+plugin; the effect keys on what it means.
  }, [host.active, watch.call, unwatch.call]);

  // The age label needs a clock of its own: no sample arrives while the stack is
  // idle, so a stamp would sit at "just now" forever without one.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  const snapshot = realtime.value;
  const history = useMemo(() => snapshot?.history ?? null, [snapshot]);
  // The kit's realtime state exposes `stale`/`isLoading`/`refresh` but no
  // in-flight flag — the RPC call's own `pending` is the honest spinner.
  const refreshing = sample.pending;

  // The arm attempt is also the LIVENESS probe: a plugin whose server half is
  // not loaded answers this route with a 404, which the kit reports as
  // `plugin_not_loaded`. That is the state a plugin installed into a running
  // chamber sits in until its server half loads — and the reason this panel
  // used to open on "No sample yet." with nothing on screen to explain it.
  const serverDown = watch.error?.code === 'plugin_not_loaded';

  if (!snapshot && serverDown) {
    return (
      <Panel title="Stats">
        <div class="flex flex-col gap-2 p-2">
          <Note tone="error">The Stats server half is not running, so nothing is being measured.</Note>
          <Note>
            It loads at chamber startup. If you just installed or updated this plugin, restart Kabmo — a fresh
            start loads it. If it is already running, check the plugin is enabled in Settings → Panel Plugins.
          </Note>
        </div>
      </Panel>
    );
  }

  if (!snapshot) {
    return (
      <Panel title="Stats">
        <Empty>Sampling the process table…</Empty>
      </Panel>
    );
  }

  if (!snapshot.probe.supported && snapshot.rows.length === 0) {
    return (
      <Panel title="Stats">
        <Note tone="error">{snapshot.error ?? `No process probe for ${snapshot.probe.name}.`}</Note>
      </Panel>
    );
  }

  return (
    <Panel title="Stats">
      <div class="-m-3 p-2 flex flex-col">
        <TotalsBar snapshot={snapshot} onRefresh={() => void sample.call({ force: true })} refreshing={refreshing} />

        {history ? (
          <div class="flex flex-col gap-1.5 border-b border-ink/10 px-3 py-2">
            <Sparkline values={history.rss} label="rss" tone="text-info" format={formatBytes} />
            <Sparkline values={history.cpuPercent} label="cpu" tone="text-warning" format={(value) => formatPercent(value)} />
          </div>
        ) : null}

        <ProcessTable snapshot={snapshot} />

        <div class="flex flex-col gap-2 px-3 py-3 border-t border-ink/10">
          <div class="flex items-center gap-2">
            <span class="text-[10px] uppercase font-mono text-ink/40">Machine</span>
            <span class="ml-auto text-[10px] font-mono text-ink/40">
              {realtime.stale ? 'stale — ' : ''}
              {formatAge(snapshot.sampledAt, now)} · probe {snapshot.probe.name}
            </span>
          </div>
          <MachineFacts snapshot={snapshot} />

          {snapshot.daemons.length > 0 ? (
            <div class="flex flex-col gap-1">
              <span class="text-[10px] uppercase font-mono text-ink/40">omp daemons</span>
              {snapshot.daemons.map((daemon) => (
                <div key={`${daemon.name}:${daemon.pid}`} class="flex items-center gap-2 text-[10px] font-mono">
                  <span class="text-ink/70 truncate" title={daemon.projectDir || undefined}>
                    {daemon.name}
                  </span>
                  <span class="text-ink/40">pid {daemon.pid}</span>
                  <span class="text-ink/40">{daemon.state}</span>
                  {daemon.brokerPid !== null ? <span class="text-ink/30">broker {daemon.brokerPid}</span> : null}
                  {/* The registry is read machine-wide, so a daemon for another
                      project is visible here — naming its project is what keeps
                      that readable rather than a mystery in the totals. */}
                  {daemon.projectDir ? (
                    <span class="ml-auto text-ink/30 truncate" title={daemon.projectDir}>
                      {daemon.projectDir.slice(daemon.projectDir.lastIndexOf('/') + 1)}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          <span class="text-[10px] font-mono text-ink/35">
            {formatBytes(snapshot.total.rss)} across {snapshot.total.processes} processes
          </span>
        </div>
      </div>
    </Panel>
  );
}

export default definePluginApp((app) => {
  app.rightPanel({
    id: 'stats',
    // The bar shows `<title> — <plugin name>`, so this is the half that names
    // the VIEW: `Stats` here would read `Stats — Stats`.
    title: 'Resources',
    component: StatsPanel,
    // Telemetry tables need room before they wrap — the same floor the
    // chamber's own Context view takes.
    minWidth: 420,
  });
});
