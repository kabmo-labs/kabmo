import { Elysia } from 'elysia';
import pkg from '@/../package.json';
import shell from '@/../index.html';
import { apiRoutes } from '@/server/routes';
import { initRealtimeTopics } from '@/server/lib/realtime/topics.server';
import { startSessionsWatch } from '@/server/lib/omp/session/sessions-watch.server';
import { authGate, initAuth } from '@/server/lib/auth/guard';
import { resolveRunPassword } from '@/server/lib/auth/env-password';
import { ssrRoutes } from '@/server/plugins/ssr';
import { setListener } from '@/server/lib/lifecycle/listener';
import { getDatabasePath, getDb } from '@/server/db.server';
import { compactChatOverlayRows } from '@/server/lib/db/compact-chat-overlay';
import { fetchOmpRegistrySnapshot } from '@/server/lib/models/provider-registry.server';
import { ompStartupError, ompStartupLogLines } from '@/server/lib/omp/core/startup';
import { readInstanceRecord, removeInstanceRecord, writeInstanceRecord } from '@/server/lib/lifecycle/instance';
import { resolveLaunchMode } from '@/server/lib/lifecycle/launch-mode';
import { isTrayEnabledByArgv } from '@/server/lib/lifecycle/argv-flags';
import { ensureTray } from '@/server/lib/tray/runtime.server';
import { packageDir } from '@/server/lib/fs/package-root';
import { acquirePortLock, claimPort, PortInUseError } from '@/server/lib/lifecycle/port-guard';
import { ensureTlsCertificate, isTlsEnabledByArgv } from '@/server/lib/lifecycle/tls';
import { SHELL_ROUTE } from '@/server/lib/lifecycle/shell-route';
import { isMockMode } from '@/server/mock.server';
import { stopDiscoveryRootsWatch, syncDiscoveryRootsWatch } from '@/server/lib/omp/config/roots-watch.server';
import { startScheduleRuntime, stopScheduleRuntime } from '@/server/lib/schedule/runtime.server';
import { seedDefaultMarketplace } from '@/server/lib/panels/seed.server';
import { syncBundledPlugins } from '@/server/lib/panels/sync.server';
import { startPanelAutoUpdate } from '@/server/lib/panels/auto-update.server';
import { disposeAllPluginsOnShutdown, loadPluginServers } from '@/server/lib/plugins/loader.server';

// Refuse to run without a resolvable omp binary — before the listener opens and
// before the first request can reach a route that shells out to it. The database
// is opened lazily by getDb(), so this exits without touching it.
const startupError = ompStartupError();
if (startupError) {
  console.error(startupError);
  process.exit(1);
}

// Authentication is armed here, before the listener opens and before anything
// can spawn a child. The password comes from `--ui-password` or
// `OMPCHAMBER_UI_PASSWORD` for THIS run only — the environment variable is
// erased as it is read, so neither the terminal panel's PTY nor an agent-run
// command can see it. With neither source given, the server runs open, which is
// the default.
const runPassword = resolveRunPassword();
const authNotice = await initAuth(runPassword.password);

// Which omp the chamber drives, which ~/.omp tree it reads and which SQLite file
// it writes — the paths every session/agent diagnostic traces back to. The data
// mode comes first because it changes what every later line means.
console.log(`[ompchamber] mock mode:      ${isMockMode() ? 'true (demo presets)' : 'false (real omp data)'}`);
// Printed with the bind address beside it, because those two facts decide the
// risk: a network-exposed listener with no password is reachable by anyone who
// can route to the host. The source matters too — `env` means the variable was
// just erased, `argv` means it is still visible in this process's command line.
console.log(`[ompchamber] ui auth:        ${authNotice}${runPassword.source === 'argv' ? ' [from argv]' : ''}`);
for (const line of ompStartupLogLines()) console.log(`[ompchamber] ${line}`);
console.log(`[ompchamber] db:             ${await getDatabasePath()}`);

const port = Number(Bun.env.PORT) || 3000;
const host = Bun.env.HOST || 'localhost';
const mode = Bun.env.NODE_ENV === 'production' ? 'prod' : 'dev';
// argv, not env: see launch-mode.ts — an inherited `OMPCHAMBER_LAUNCH_MODE`
// would label a `bun run dev` started inside an OMPChamber shell as `daemon`.
const launchMode = resolveLaunchMode();

// TLS is decided before the bind, because a certificate that cannot be produced
// must fail here — with the port still free — rather than after the listener is
// up and clients are connecting in cleartext.
const tlsRequested = isTlsEnabledByArgv();
let tlsOptions: { cert: Bun.BunFile; key: Bun.BunFile } | null = null;
if (tlsRequested) {
  const certificate = ensureTlsCertificate();
  if (!certificate.ok) {
    console.error(`[ompchamber] --tls was given but no certificate could be prepared:\n  ${certificate.error}`);
    process.exit(1);
  }
  tlsOptions = { cert: Bun.file(certificate.certPath), key: Bun.file(certificate.keyPath) };
  console.log(`[ompchamber] tls:             on (${certificate.generated ? 'certificate generated' : 'certificate reused'}) at ${certificate.certPath}`);
}

const lock = await acquirePortLock(port);
if (!lock) {
  console.error(`[ompchamber] another OMPChamber instance is starting on port ${port} right now — retry in a moment.`);
  process.exit(1);
}

// `serve.routes` is where the HTML shell lives. Elysia merges its own static
// routes into that same table (its Bun adapter passes `serve` straight to
// `Bun.serve`), and Bun's table wins for the paths it declares — so `/_shell`
// renders the bundle while every other path falls through to `fetch`. The
// WebSocket routes keep working: Elysia composes its `websocket` handler
// alongside this object.
const app = new Elysia({ serve: { routes: { [SHELL_ROUTE]: shell } } })
  .onBeforeHandle((context) => {
    // The socket address is read INLINE, and that is not a style choice.
    // Passing this Elysia context to a helper function — however simple, even
    // one that only reads a property — makes the request body arrive already
    // consumed (`request.bodyUsed === true` before any handler runs), so every
    // POST body parses as empty. Measured on Bun 1.4.2 + Elysia 1.4.30: a hook
    // that is `authGate(c.request, clientAddressFromContext(c))` lost the body,
    // while the identical logic written inline kept it, and the same held for a
    // helper whose whole body was `'request' in c`.
    //
    // `requestIP` is the socket address, so a rate limit keyed on it cannot be
    // evaded by a forged `x-forwarded-for`. `server` is absent in a non-Bun
    // adapter or a test harness; the gate then runs without an address and the
    // login route falls back to the shared unknown-client budget.
    const requestIp = (context.server as { requestIP?: (request: Request) => { address?: string } | null } | undefined)
      ?.requestIP?.(context.request);
    return authGate(context.request, requestIp?.address);
  })
  .use(apiRoutes)
  .use(ssrRoutes);

// The panel marketplace is seeded BEFORE the listener opens: the first request
// for `/api/panels` must already see the bundled defaults, or the settings pane
// flashes an empty marketplace and the activity bar omits a plugin that is
// about to appear. Marker-guarded, so a plugin the user removed stays removed.
try {
  const seeded = await seedDefaultMarketplace();
  if (seeded.seeded) console.log('[ompchamber] marketplace:   seeded the bundled panel plugins');
  // A build failure leaves the plugin in place but unservable, and the pane
  // offers a Rebuild — reported here so a headless start says why.
  if (seeded.reason) console.error(`[panels] plugin build: ${seeded.reason}`);
} catch (error) {
  console.error('[panels] marketplace seed skipped:', error);
}

// The realtime hub's topics and its change-signal subscriptions are registered
// before the listener opens, so a client connecting in the first second gets a
// snapshot rather than an `unknown_topic`. Idempotent: a hot reload re-runs it.
initRealtimeTopics();

// A session FILE appearing is what makes a session visible in the sidebar, and
// omp writes it only when the first assistant message settles — a moment no
// chamber write reports. Watching the sessions root is what replaces the 30s
// idle poll that used to cover it.
startSessionsWatch();

try {
  await claimPort({
    port,
    host,
    listen: async () => {
      // `reusePort: false` is load-bearing: Elysia's Bun adapter hardcodes
      // `reusePort: true`, which lets a second server bind a port already in
      // use and then sit invisible while the first-bound socket takes every
      // connection.
      app.listen({
        port,
        hostname: host,
        reusePort: false,
        // Passed through to `Bun.serve`: Elysia spreads the listen options into
        // its serve config (verified on 1.4.30 — the listener reports
        // `protocol: 'https'` and answers only TLS).
        ...(tlsOptions ? { tls: tlsOptions } : {}),
      });
      if (!app.server) throw new Error('Bun.serve returned no listener');
      // The shell is rendered by asking this same listener for it: Bun renders
      // an HTML route only while serving, and there is no in-process API for an
      // `HTMLBundle` (`new Response(bundle)` is "[object HTMLBundle]",
      // `app.handle` answers 404). Handing the listener over is what makes
      // `renderShell()` possible — and the dev asset proxy reaches Bun's own
      // asset routes through it for the same reason.
      //
      // The TLS options travel with it: this process asking its own listener must
      // not verify the certificate it generated for itself, or every page fails
      // to render. `tls` is Bun's own fetch option, absent from the DOM's
      // `RequestInit` — the cast names that gap once, here.
      setListener(
        app.server,
        tlsOptions ? ({ tls: { rejectUnauthorized: false } } as RequestInit) : undefined,
      );
    },
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(error instanceof PortInUseError ? `[ompchamber] ${message}` : `[ompchamber] could not listen on ${host}:${port} — ${message}`);
  process.exit(1);
} finally {
  lock.release();
}

// The record is written by the process that owns the port, so `status`, `stop`
// and the next `serve` see dev, foreground and daemon servers alike. A hot
// reload re-runs this entry in the same process: keeping the first `startedAt`
// for a PID that already recorded this port is what makes `status` report real
// uptime instead of resetting it on every save.
const previousRecord = readInstanceRecord(port);
if (!writeInstanceRecord({
  pid: process.pid,
  port,
  host,
  mode,
  launchMode,
  startedAt: previousRecord?.pid === process.pid ? previousRecord.startedAt : new Date().toISOString(),
  version: pkg.version,
})) {
  console.log('[ompchamber] instance record not written (data directory not writable) — `ompchamber status` will fall back to probing this port');
}
process.on('exit', () => removeInstanceRecord(port));

// The listener is already accepting requests here, so the probe only postpones
// this last banner line, never startup. Printing it after the probe keeps the
// one line that matters — the URL — at the bottom of the log.
await logDetectedRegistry();

console.log(`[ompchamber] listening on ${tlsOptions ? 'https' : 'http'}://${host}:${port}`);

/**
 * One-time rewrite of the overlay rows written before `overlayRowsForOmpSession`
 * existed — see the module. Deliberately HERE, after the banner, and NOT inside
 * `getDb()`: the test suite and the CLI reach `getDb()` in real mode too, and
 * merely opening the database must not be able to launch a rewrite of every
 * mirrored conversation. (It could: a `bun test` run compacted a live database.)
 * The pass is marker-keyed, so from the second start it is one indexed SELECT,
 * and it reports its own per-row failures rather than throwing.
 */
try {
  await compactChatOverlayRows(await getDb());
} catch (error) {
  console.error('[chat-overlay] compaction skipped:', error);
}

/**
 * Watch the skill/command roots omp reads, so a SKILL.md written by anything
 * other than the chamber (a hand edit, `git pull`, the skills CLI, another
 * agent) reaches the live sessions without a restart. See the module — the
 * refresh itself is `/reload-plugins`, this only decides when.
 */
try {
  await syncDiscoveryRootsWatch();
} catch (error) {
  console.error('[discovery-watch] watcher setup skipped:', error);
}

/**
 * The scheduled-task clock. Started after the listener is up and the watchers
 * are attached, so a task that fires early cannot race the schema or the
 * discovery roots; the runtime's own first tick is delayed for the same reason.
 * Idempotent, and anchored on `globalThis` — a `bun --hot` reload must not
 * leave a second interval running.
 */
startScheduleRuntime();

/**
 * The plugin platform's server half. After the listener is up and the
 * scheduled-task clock exists — a plugin's own schedules are registered with
 * the same runtime, so starting a plugin before it would race the schema and
 * the timer. Never throws: one broken plugin must not stop the server from
 * booting, and its reason is reported here and by `GET /api/plugins`.
 */
try {
  const result = await loadPluginServers();
  if (result.loaded.length > 0) {
    console.log(`[ompchamber] plugins:        ${result.loaded.length} server half(s) loaded (${result.loaded.join(', ')})`);
  }
  for (const failure of result.errors) console.error(`[plugins] ${failure.pluginId}: ${failure.reason}`);
} catch (error) {
  console.error('[plugins] server halves skipped:', error);
}

/**
 * Bring installed BUNDLED plugins up to the copy this package ships.
 *
 * An OMPChamber update replaces the store and leaves the install — it is a
 * copied directory of ordinary files — so this is the only thing that notices.
 * It is version-gated and skips git clones, so a plugin the user installed from
 * a URL is never overwritten by a store entry that happens to share its id.
 *
 * AFTER the server halves load, and it reloads nothing itself: a plugin whose
 * sources moved has a new bundle the browser fetches on the next load, while its
 * server half was loaded from the OLD sources a moment ago. That half is left
 * running until the next restart on purpose — replacing a module a live plugin
 * registered routes from is the one thing this pass must not do unannounced —
 * and the pane reports the plugin as updated, which is where a user looks.
 */
try {
  const synced = await syncBundledPlugins();
  for (const item of synced.updated) {
    console.log(`[ompchamber] plugins:        synced ${item.pluginId} ${item.from} → ${item.to}`);
    if (item.warning) console.error(`[plugins] ${item.pluginId}: rebuild after sync failed — ${item.warning}`);
  }
  for (const failure of synced.failed) console.error(`[plugins] ${failure.pluginId}: bundled sync failed — ${failure.error}`);
} catch (error) {
  console.error('[plugins] bundled sync skipped:', error);
}

/**
 * The git-plugin freshness clock. Opt-in, and started after the plugin platform
 * so its first pass sees the plugins that are actually installed — the setting
 * is read on every pass, so switching it off in the pane stops the next one.
 */
startPanelAutoUpdate();

/**
 * The tray icon, when `--tray` was passed (`serve --tray`, or the login entry
 * the CLI writes for `--startup`). After the listener is up, because the config
 * it writes carries the URL the icon opens and the login row it draws, and both
 * must describe a server that is actually serving. Never throws: a machine with
 * no tray client (Linux without yad/zenity) reports why and keeps serving.
 */
if (isTrayEnabledByArgv()) {
  const result = ensureTray({ port, host, tls: Boolean(tlsOptions), pkgRoot: packageDir() });
  if (result.started) console.log('[ompchamber] tray:            icon shown');
  else console.log(`[ompchamber] tray:            not shown — ${result.reason}`);
}

/**
 * What omp reports it can actually run. A live RPC round-trip: a cold utility
 * process takes seconds, which is why it runs after the listener is up. Side
 * benefit — it warms the shared utility process the model picker drives, so the
 * first /api/models call does not pay the spawn.
 */
async function logDetectedRegistry(): Promise<void> {
  if (isMockMode()) {
    console.log('[ompchamber] providers:      n/a (MOCK mode)');
    console.log('[ompchamber] models:         n/a (MOCK mode)');
    return;
  }
  try {
    const { providers, models } = await fetchOmpRegistrySnapshot();
    // Count providers that actually serve a model — the distinct `provider`
    // values in the model list, i.e. the same set GET /api/models groups by.
    // omp's login catalog lists every sign-in offer it supports (75 here, 73 of
    // them without credentials); counting those would report a provider set the
    // chamber cannot use. The catalog size is kept as context.
    const servingProviders = new Set(models.map((model) => model.provider)).size;
    console.log(`[ompchamber] providers:      ${servingProviders} detected (${providers.length} known to omp)`);
    console.log(`[ompchamber] models:         ${models.length} detected`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`[ompchamber] providers/models: detection failed — ${message}`);
  }
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    stopDiscoveryRootsWatch();
    stopScheduleRuntime();
    void app.stop();
    // Plugins own children and listeners nothing else releases, and a detached
    // child outlives its parent — so this is awaited BEFORE the exit. It is
    // bounded internally, so a plugin that hangs cannot hold the port.
    void disposeAllPluginsOnShutdown().finally(() => process.exit(0));
  });
}
