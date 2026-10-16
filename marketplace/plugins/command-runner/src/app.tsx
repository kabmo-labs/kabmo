/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Command Runner's app half.
 *
 * ## What this half owns, and what it does not
 *
 * The panel reads two things and writes one: the SCAN (an RPC that reads files
 * and parses them server-side, because a browser has no filesystem), the RUN LIST
 * (the plugin's own realtime topic, so a reload or a second tab sees the runs
 * that are live rather than an empty list), and the START/STOP calls. It owns no
 * state of its own beyond which logs it has read — the server is the source of
 * truth for a run, and a copy here would be a second answer.
 *
 * ## Enablement is PER COMMAND
 *
 * `commandRunner.enabled` is a `Record<commandId, boolean>` in the session's own
 * store, and it replaces the two global checkboxes this panel used to carry.
 * `dev` wants a background job with its log open; `lint` wants neither; one pair
 * of header checkboxes cannot say both. An ENABLED command's row keeps its output
 * open, and disabling one that is running stops it first — "this command must not
 * be running" is what the button means, so leaving a process alive would be a lie.
 *
 * ## The log is read per ROW, on that run's byte count
 *
 * Each row asks for its own run's log when it is shown, and re-reads when that
 * run's `bytes` moves. A closed row costs nothing; a run that prints nothing
 * costs nothing; a streaming one costs one read per publish, which the server
 * throttles to 250 ms per run. A timer would re-send up to 64 KB to report that
 * nothing changed.
 *
 * ## The content script is the force-stop
 *
 * A plugin panel is UNMOUNTED while another view is on screen, so a repo switch
 * made from the Files panel would leave this plugin's processes running with no
 * watcher alive. The content script mounts for as long as the plugin is enabled,
 * regardless of which panel is shown, and that is the only place the switch can
 * be observed. It renders nothing.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { definePluginApp } from '@ompchamber/plugin-sdk/app';
import {
  usePanelHost,
  usePanelInfo,
  usePluginId,
  useRealtime,
  useRpc,
  useRepoScope,
  useSessionState,
} from '@ompchamber/ui';

import { PanelView } from './panel';
import { mountScopeWatch, stopOtherScopes } from './watch';
import { RPC, type CommandListing, type RunLog, type RunnerState } from './protocol';
import { useCustomDialog } from './panel/use-custom-dialog';

/** The right-panel view, wired to the plugin's own server half. */
function CommandRunnerPanel() {
  const pluginId = usePluginId();
  const info = usePanelInfo();
  // The host's own "draw your header" flag: the phone's drawer renders its own
  // tab strip above the view, so a second header would name the same panel twice.
  const host = usePanelHost();
  const repo = useRepoScope();
  const list = useRpc<{ root: string; repo: string }, CommandListing>(RPC.list);
  const start = useRpc<Record<string, unknown>, { runId: string }>(RPC.start);
  const stop = useRpc<{ runId: string }, { stopped: boolean }>(RPC.stop);
  const stopAll = useRpc<{ root: string; repo: string; sessionId: string | null }, { stopped: number }>(RPC.stopAll);
  const state = useRealtime<RunnerState>();

  // The two per-command toggles, persisted per session under this plugin's own
  // keys — the typed session service carries no namespace, so the `commandRunner.`
  // prefix is what keeps a plugin out of the host's key space. They are the two
  // panel-wide checkboxes this panel used to carry (`Output`, `Background`),
  // moved onto each command because the answer differs per command.
  // Which FILES the reader collapsed. Absent means expanded — the same shape the
  // todo panel uses for its phases, and the reason a workspace seen for the first
  // time shows its commands rather than hiding them.
  const [collapsedGroups, setCollapsedGroups] = useSessionState<Record<string, boolean>>(
    'commandRunner.collapsedGroups',
    {},
  );
  const [background, setBackground] = useSessionState<Record<string, boolean>>('commandRunner.background', {});

  const [listing, setListing] = useState<CommandListing | null>(null);
  const [listingError, setListingError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** The logs read so far, by run id — one entry per row that has been shown. */
  const [logs, setLogs] = useState<Record<string, RunLog>>({});

  const scope = repo.root ? { root: repo.root, repo: repo.repo } : null;
  const runs = state.value?.runs ?? [];

  // `list.call` is a NEW function per render (the hook returns a fresh state
  // object), so it must not be a dependency of the scan: doing so re-runs the scan
  // on every render and the scan's own setState renders again — an unbounded loop
  // of `list` calls (measured: hundreds of requests in seconds, which also starved
  // the render so the rows never appeared). The ref keeps the effect keyed on the
  // SCOPE, which is the real trigger.
  const listRef = useRef(list.call);
  listRef.current = list.call;

  const scan = useCallback(async () => {
    if (!scope) {
      setListing(null);
      return;
    }
    setLoading(true);
    const outcome = await listRef.current(scope);
    setLoading(false);
    if (outcome.ok) {
      setListing(outcome.value as CommandListing);
      setListingError(null);
    } else {
      // A refusal is REPORTED, never rendered as an empty list: the two look the
      // same on screen and only one is actionable.
      setListingError(outcome.error.message);
    }
  }, [scope?.root, scope?.repo]);

  // Re-scan when the scope moves. The dependency is the pair, so a repo switch
  // (or a workspace switch) reads the new tree rather than keeping the old list.
  useEffect(() => {
    void scan();
  }, [scan]);

  // The user's own commands: the add/edit dialog, its three calls, and the
  // re-scan every mutation owes the list.
  const dialog = useCustomDialog({ root: scope?.root ?? null, rescan: scan });

  // A sweep when the panel mounts, as the second net. The content script covers a
  // switch made while this panel is unmounted, but a chamber that was reloaded has
  // had no watcher run yet and a phone has no content script at all — so the panel
  // also asks, and the call is idempotent either way.
  //
  // The SESSION is sent because the sweep is session-scoped: asking as `null`
  // would match none of this panel's runs.
  useEffect(() => {
    if (!pluginId || !scope) return;
    void stopOtherScopes(pluginId, scope, info.sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginId, scope?.root, scope?.repo, info.sessionId]);

  const startRef = useRef(start.call);
  startRef.current = start.call;
  const stopRef = useRef(stop.call);
  stopRef.current = stop.call;
  const stopAllRef = useRef(stopAll.call);
  stopAllRef.current = stopAll.call;

  const handleRun = useCallback(
    (commandId: string) => {
      if (!scope) return;
      // The command's OWN background toggle decides how it is tracked — the
      // panel no longer has a global default to fall back on.
      const asJob = background[commandId] === true;
      // The SESSION travels with the run, and it must be the real one: the scope
      // sweep is session-scoped, so a run recorded against `null` is never matched
      // by a watcher that sweeps `'s1'` — measured as a background job that
      // survived a repo switch because `stop-others` answered `stopped: 0`.
      void startRef.current({ ...scope, sessionId: info.sessionId, commandId, background: asJob });
    },
    [scope?.root, scope?.repo, info.sessionId, background],
  );

  const handleStop = useCallback((runId: string) => void stopRef.current({ runId }), []);

  /** Collapse (or expand) one command file's group. */
  const handleToggleGroup = useCallback(
    (file: string, collapsed: boolean) => {
      setCollapsedGroups((current) => ({ ...current, [file]: collapsed }));
    },
    [setCollapsedGroups],
  );

  /**
   * Track (or stop tracking) a command as a background job.
   *
   * Turning it OFF stops the command's runs: a toggle that says "not a job" while
   * the job keeps running is a lie, and this is the only control that ends one.
   * The sweep is session-wide because that is the scope the registry matches on.
   */
  const handleToggleBackground = useCallback(
    (commandId: string, next: boolean) => {
      setBackground((current) => ({ ...current, [commandId]: next }));
      if (next || !scope) return;
      void stopAllRef.current({ ...scope, sessionId: info.sessionId });
    },
    [setBackground, scope?.root, scope?.repo, info.sessionId],
  );

  /**
   * Read one run's log into the store.
   *
   * Called by a row when it is shown and whenever that run's byte count moves, so
   * the SAME run is read repeatedly as it prints.
   *
   * **A plain `fetch`, not the kit's `useChamberFetch`, and that is the fix for a
   * real bug.** The hook re-reads when its URL CHANGES; a repeat read of one run
   * is the same URL, so the second request never happened — measured: a run that
   * printed produced no log in the panel at all, because the only read issued was
   * the one at mount, before the process had written anything. The hook is right
   * for "read this resource as it changes"; this is "read it again now", which is
   * a call, not a subscription.
   *
   * The store is keyed by run id, so two open rows read independently, and a
   * superseded answer for one run cannot land under another's.
   */
  const handleReadLog = useCallback(
    async (runId: string) => {
      if (!pluginId) return;
      try {
        const response = await fetch(
          `/api/plugins/${pluginId}/http/logs?id=${encodeURIComponent(runId)}`,
          { credentials: 'same-origin' },
        );
        if (!response.ok) return;
        const log = (await response.json()) as RunLog;
        setLogs((current) => ({ ...current, [runId]: log }));
      } catch {
        // A failed read leaves the previous log on screen; the next byte count
        // moving re-reads, so a transient failure repairs itself.
      }
    },
    [pluginId],
  );

  return (
    <PanelView
      listing={listing}
      listingError={listingError}
      loading={loading}
      runs={runs}
      collapsedGroups={collapsedGroups}
      background={background}
      logs={logs}
      scope={scope}
      showHeader={host.showHeader !== false}
      onToggleGroup={handleToggleGroup}
      onToggleBackground={handleToggleBackground}
      onRefresh={() => void scan()}
      onRun={handleRun}
      onStop={handleStop}
      onReadLog={handleReadLog}
      formOpen={dialog.open}
      editing={dialog.editing}
      defaultCwd={scope?.repo ?? '.'}
      formError={dialog.error}
      onAdd={dialog.add}
      onEdit={dialog.edit}
      onRemove={dialog.remove}
      onSubmit={dialog.submit}
      onCancelForm={dialog.close}
    />
  );
}

export default definePluginApp((app) => {
  app.rightPanel({
    id: 'command-runner',
    // The bar reads `<title> — <plugin name>`, so this is the half naming the
    // VIEW: `Runner` here would read `Runner — Runner`.
    title: 'Commands',
    component: CommandRunnerPanel,
    // A command row plus its label and status needs room before it wraps.
    minWidth: 420,
  });

  // The force-stop watcher. It renders nothing and exists so a repo switch is
  // observed even while this panel is unmounted — the panel is not mounted when
  // another view is on screen, and a repo switch made from the Files panel would
  // otherwise leave this plugin's processes running with nothing to notice.
  app.contentScript({
    id: 'scope-watch',
    mount: mountScopeWatch,
  });
});
