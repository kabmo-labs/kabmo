import { Elysia } from 'elysia';
import pkg from '@/../package.json';
import shell from '@/../index.html';
import { apiRoutes } from '@/server/routes';
import { initRealtimeTopics } from '@/server/lib/realtime/topics.server';
import { startSessionsWatch } from '@/server/lib/omp/session/sessions-watch.server';
import { authGate, initAuth, initAuthFromHandover, isAuthEnabled } from '@/server/lib/auth/guard';
import { resolveRunPassword } from '@/server/lib/auth/env-password';
import { readHandoverFromStdin } from '@/shared/lib/auth/handover';
import { ssrRoutes } from '@/server/plugins/ssr';
import { setListener } from '@/server/lib/lifecycle/listener';
import { getDatabasePath } from '@/server/db.server';
import { logDetectedRegistry } from '@/server/lib/models/detected-registry.server';
import { ompStartupError, ompStartupLogLines } from '@/server/lib/omp/core/startup';
import { readInstanceRecord, removeInstanceRecord, writeInstanceRecord } from '@/server/lib/lifecycle/instance';
import { resolveLaunchMode } from '@/server/lib/lifecycle/launch-mode';
import { isTrayEnabledByArgv } from '@/server/lib/lifecycle/argv-flags';
import { acquirePortLock, claimPort, PortInUseError } from '@/server/lib/lifecycle/port-guard';
import { ensureTlsCertificate, isTlsEnabledByArgv } from '@/server/lib/lifecycle/tls';
import { SHELL_ROUTE } from '@/server/lib/lifecycle/shell-route';
import { isMockMode } from '@/server/mock.server';
import { migrateLegacyDataDir } from '@/server/lib/lifecycle/paths';
import { seedDefaultMarketplace } from '@/server/lib/panels/seed.server';
import { installRejectionGuard } from '@/server/lib/lifecycle/rejection-guard';
import { installShutdownHandlers, runAfterListenTasks } from '@/server/lib/lifecycle/after-listen';

// A pre-rename install keeps its database, login and sessions: the data
// directory is moved into place before ANYTHING reads a path under it. This is
// the first statement in the file for that reason — the auth secret, the
// instance record and the SQLite file all live there.
migrateLegacyDataDir();

// Before anything starts a timer, a plugin or a socket: a rejection from code we
// do not own (a marketplace plugin's own background loop) must be REPORTED, not
// allowed to exit a process that hosts every live session. See the module.
installRejectionGuard();

// Refuse to run without a resolvable omp binary — before the listener opens and
// before the first request can reach a route that shells out to it. The database
// is opened lazily by getDb(), so this exits without touching it.
const startupError = ompStartupError();
if (startupError) {
  console.error(startupError);
  process.exit(1);
}

// Authentication is armed here, before the listener opens and before anything
// can spawn a child. The credential arrives by argv, by a handover on stdin
// (from the CLI, or from the instance being replaced), or through the legacy
// `KABMO_UI_PASSWORD` — which is NOT a safe channel: `delete Bun.env.X`
// leaves the value in the OS environ a child inherits (measured on Bun 1.4.3).
// No source means the server runs open, which is the default.
const runPassword = resolveRunPassword();
const handover = await readHandoverFromStdin();
const authNotice = handover
  ? await initAuthFromHandover(handover)
  : await initAuth(runPassword.password);

// Which omp Kabmo drives, which ~/.omp tree it reads and which SQLite file
// it writes — the paths every session/agent diagnostic traces back to. The data
// mode comes first because it changes what every later line means.
console.log(`[kabmo] mock mode:      ${isMockMode() ? 'true (demo presets)' : 'false (real omp data)'}`);
// Printed with the bind address beside it, because those two facts decide the
// risk: a network-exposed listener with no password is reachable by anyone who
// can route to the host. The source matters too — `env` means the variable was
// just erased, `argv` means it is still visible in this process's command line.
console.log(`[kabmo] ui auth:        ${authNotice}${runPassword.source === 'argv' ? ' [from argv]' : ''}`);
for (const line of ompStartupLogLines()) console.log(`[kabmo] ${line}`);
console.log(`[kabmo] db:             ${await getDatabasePath()}`);

const port = Number(Bun.env.PORT) || 3000;
const host = Bun.env.HOST || 'localhost';
const mode = Bun.env.NODE_ENV === 'production' ? 'prod' : 'dev';
// argv, not env: see launch-mode.ts — an inherited `KABMO_LAUNCH_MODE`
// would label a `bun run dev` started inside a Kabmo shell as `daemon`.
const launchMode = resolveLaunchMode();

// TLS is decided before the bind, because a certificate that cannot be produced
// must fail here — with the port still free — rather than after the listener is
// up and clients are connecting in cleartext.
const tlsRequested = isTlsEnabledByArgv();
let tlsOptions: { cert: Bun.BunFile; key: Bun.BunFile } | null = null;
if (tlsRequested) {
  const certificate = ensureTlsCertificate();
  if (!certificate.ok) {
    console.error(`[kabmo] --tls was given but no certificate could be prepared:\n  ${certificate.error}`);
    process.exit(1);
  }
  tlsOptions = { cert: Bun.file(certificate.certPath), key: Bun.file(certificate.keyPath) };
  console.log(`[kabmo] tls:             on (${certificate.generated ? 'certificate generated' : 'certificate reused'}) at ${certificate.certPath}`);
}

const lock = await acquirePortLock(port);
if (!lock) {
  console.error(`[kabmo] another Kabmo instance is starting on port ${port} right now — retry in a moment.`);
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
  if (seeded.seeded) console.log('[kabmo] marketplace:   seeded the bundled panel plugins');
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
// Kabmo write reports. Watching the sessions root is what replaces the 30s
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
  console.error(error instanceof PortInUseError ? `[kabmo] ${message}` : `[kabmo] could not listen on ${host}:${port} — ${message}`);
  process.exit(1);
} finally {
  lock.release();
}

// Written by the process that owns the port, so `status`, `stop` and the next
// `serve` see dev, foreground and daemon servers alike. A hot reload re-runs
// this entry in the same process, so a PID that already recorded this port keeps
// its first `startedAt` and `status` reports real uptime.
const previousRecord = readInstanceRecord(port);
if (!writeInstanceRecord({
  pid: process.pid,
  port,
  host,
  mode,
  launchMode,
  // The flags this run was given — a replacement's own argv cannot recover them.
  tray: isTrayEnabledByArgv(), tls: tlsRequested, auth: isAuthEnabled(),
  startedAt: previousRecord?.pid === process.pid ? previousRecord.startedAt : new Date().toISOString(),
  version: pkg.version,
})) {
  console.log('[kabmo] instance record not written (data directory not writable) — `kabmo status` will fall back to probing this port');
}
process.on('exit', () => removeInstanceRecord(port));

// The listener is already accepting requests here, so the probe only postpones
// this last banner line, never startup. Printing it after the probe keeps the
// one line that matters — the URL — at the bottom of the log.
await logDetectedRegistry();

console.log(`[kabmo] listening on ${tlsOptions ? 'https' : 'http'}://${host}:${port}`);

await runAfterListenTasks({ port, host, tls: Boolean(tlsOptions) });
installShutdownHandlers(() => void app.stop());
