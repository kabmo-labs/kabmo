// `ompchamber serve` — start the Kabmo server.
//
// Two flags live here beyond the server's own options, and both are about the
// process tree rather than about the listener:
//
//   --tray       the server raises a menu-bar/notification-area icon for itself
//   --startup    the server is registered to start at login (implying --tray now)
//   --no-startup the login entry is removed
//
// `--startup`/`--no-startup` are handled by the CLI rather than by the server,
// because they write a file outside the data directory (`~/Library/LaunchAgents`,
// `$XDG_CONFIG_HOME/autostart`, `HKCU\...\Run`) — the one thing a running server
// has no business doing behind the operator's back. The entry it writes runs the
// SERVER in the foreground with `--tray`, so the login-started instance is a
// first-class one: `status`, `logs` and `stop` all find it.

import { joinPath, resolvePath } from '@/cli/lib/path-utils.js';
import {
  spawnDetachedServer,
  buildServeInvocation,
  waitForHealth,
  findLiveInstance,
  resolveBunBin,
} from '@/cli/lib/runtime.js';
import { buildProductionBundle } from '@/cli/lib/build.js';
import { probeHost } from '@/server/lib/lifecycle/probe';
import { log, ok, warn, fail, printJson, isJson, isQuiet } from '@/cli/lib/output.js';
import { wireChildProcessLifecycle } from '@/cli/lib/process-lifecycle.js';
import { reportUiAuth, resolveUiPassword, uiPasswordHandover } from '@/cli/lib/ui-password.js';
import { PASSWORD_HANDOVER_ENV, PASSWORD_HANDOVER_STDIN } from '@/shared/lib/auth/handover';
import { UI_PASSWORD_ENV } from '@/shared/lib/auth/password';
import { getLogFilePath } from '@/cli/lib/paths.js';
import { resolveServeMode } from '@/cli/lib/serve-mode.js';
import { ompStartupError } from '@/server/lib/omp/core/startup';
import { installAutostart, uninstallAutostart, getAutostartEntryPath } from '@/server/lib/tray/autostart';
import { getAutostartCredentialPath, removeAutostartCredential, writeAutostartCredential } from '@/server/lib/tray/credential';
import { buildLoginEntryArgv } from '@/server/lib/tray/entry';

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '127.0.0.1';

export function resolvePort(options) {
  const raw = options?.port;
  if (raw !== null && raw !== undefined) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  const env = Bun.env.OMPCHAMBER_PORT;
  if (typeof env === 'string' && env.trim().length > 0) {
    const parsed = Number(env.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return DEFAULT_PORT;
}

export function resolveHost(options) {
  if (options?.lan) return '0.0.0.0';
  const raw = options?.host;
  if (typeof raw === 'string' && raw.length > 0) return raw;
  const env = Bun.env.OMPCHAMBER_HOST;
  if (typeof env === 'string' && env.length > 0) return env;
  return DEFAULT_HOST;
}

/**
 * Store the credential a login entry will read, returning its path or null.
 *
 * Null when the file could not be written: the caller then warns that the entry
 * will start without a password, which is the honest outcome — an entry that
 * names a file nobody wrote would start open with no explanation at all.
 */
function storeStartupCredential(password) {
  return writeAutostartCredential(password) ? getAutostartCredentialPath() : null;
}

/**
 * Whether this start raises a tray icon.
 *
 * `--startup` IMPLIES it: a login entry that started a headless console would
 * leave the user with no way to see or stop it from the desktop. So
 * `--startup --tray` is redundant, never wrong — and `--tray` alone does NOT
 * register anything, which is the asymmetry worth keeping: an icon is a
 * property of the run, a login entry is a change to the machine.
 */
export function trayForOptions(options) {
  return options?.tray === true || options?.startup === true;
}

export async function run(options, ctx) {
  const port = resolvePort(options);
  const host = resolveHost(options);
  const mode = resolveServeMode(options);
  const json = isJson();
  const quiet = isQuiet();
  const pkgRoot = ctx?.pkgRoot ?? process.cwd();
  const tls = options?.tls === true;
  const tray = trayForOptions(options);

  // The same gate the server entry applies, run here first so a missing omp
  // binary fails immediately — with no detached child spawned, no log file to
  // read and no registry entry left pointing at a process that already exited.
  const ompError = ompStartupError();
  if (ompError) fail(ompError);

  // `--no-startup` is a REGISTRATION change, not a server start, so it runs
  // before the port check and returns: asking to stop starting at login must
  // work whether or not something is already serving the port (measured: with
  // the flag below the port guard, `serve --no-startup` on a busy port failed
  // with "already served" and left the entry in place).
  if (options?.startup === false) {
    const removed = uninstallAutostart();
    // The credential exists only to serve the entry that was just removed.
    removeAutostartCredential();
    if (json) printJson({ startup: false, removed, entry: getAutostartEntryPath() });
    else if (removed) ok(`Removed the login entry${getAutostartEntryPath() ? `: ${getAutostartEntryPath()}` : ''}.`);
    else warn('No login entry was registered.');
    return;
  }

  if (mode === 'prod') {
    const builtServer = joinPath(pkgRoot, 'dist', 'client', 'index.js');
    // Bun.file().exists() is file-only (false for directories) — correct here,
    // where the target is always a regular file. For directory guards use
    // pathExists() in src/server/lib/omp/core/paths.ts.
    //
    // The built server, not `dist/client/index.html`: the production bundle is
    // the server itself (its HTML route is what emits the markup), and running
    // it is what serves the assets beside it.
    if (!(await Bun.file(builtServer).exists())) {
      if (!quiet && !json) log('No production build found — building it (this runs once)...');
      try {
        buildProductionBundle(pkgRoot, {
          onLine: quiet || json ? undefined : (chunk) => process.stdout.write(chunk),
        });
      } catch (err) {
        fail(`${err?.message ?? String(err)}\n  Or start the dev server from source:  ompchamber serve --dev`);
      }
      if (!(await Bun.file(builtServer).exists())) {
        fail(`Build finished but ${builtServer} is still missing.\n  Or start the dev server from source:  ompchamber serve --dev`);
      }
    }
  }

  const existing = await findLiveInstance(port);
  if (existing) {
    // Refused here as well as in the server (lib/lifecycle/port-guard) so the
    // CLI reports it immediately instead of spawning a child that exits during
    // the health wait. Nothing is stopped: freeing a port is `ompchamber stop`.
    fail(
      `Port ${port} is already served by Kabmo (pid ${existing.pid}, ${existing.mode}).`
      + '\n  Nothing was stopped — a starting instance never stops another one.'
      + `\n  Stop it first:  ompchamber stop --port ${port}`
      + '\n  Or start on another port:  ompchamber serve --port <port>',
    );
  }

  // Resolved before the spawn and handed over through the environment: a value
  // on the command line would be readable through `ps`. The server hashes it for
  // its own process and erases the variable, so nothing durable holds it.
  // A restarting SERVER has already hashed its credential; the CLI must pass it
  // through rather than resolve a password of its own. See
  // `lib/lifecycle/restart.ts` for why the plaintext is never respawned.
  const handoverPayload = typeof options?.handoverPayload === 'string' && options.handoverPayload.length > 0
    ? options.handoverPayload
    : null;
  const resolvedPassword = handoverPayload ? null : await resolveUiPassword(options);
  if (!handoverPayload) reportUiAuth({ resolved: resolvedPassword, host, tls });

  // `--startup` implies the tray (a login entry with no icon would start a
  // console the user cannot see from the desktop), so the registration is
  // written here and the spawn below carries `--tray`.
  if (options?.startup === true) {
    // A login entry is a world-readable command line that outlives this run, so
    // it carries a PATH to the credential rather than the secret. The file
    // lives beside `auth.json` at 0600, and the CLI reads it on the way in and
    // hands it to the server through the stdin handover — never argv, never the
    // environment.
    const credentialPath = resolvedPassword?.password
      ? storeStartupCredential(resolvedPassword.password)
      : null;
    const argv = buildLoginEntryArgv({
      bun: resolveBunBin(),
      cli: resolvePath(pkgRoot, 'src', 'cli', `${ctx?.bin ?? 'ompchamber'}.js`),
      port,
      host,
      tray: true,
      tls,
      lan: host === '0.0.0.0',
      credentialPath,
    });
    const written = installAutostart({ argv, port, logFile: getLogFilePath(port) });
    if (json) printJson({ startup: true, entry: written.path ?? 'windows-run-key' });
    else if (written.path) ok(`Registered login entry: ${written.path}`);
    else ok('Registered the Kabmo tray to start at login (Windows Run key).');
    if (resolvedPassword?.password && !credentialPath) {
      warn(
        `The login entry could not store your UI password, so it will start WITHOUT one.`
        + ` Set ${UI_PASSWORD_ENV} in the environment launchd/systemd starts it in.`,
      );
    } else if (credentialPath) {
      log(`  credential: stored for the login entry (${credentialPath}, mode 0600)`);
    }
  }

  if (options?.foreground) {
    return runForeground({ pkgRoot, mode, port, host, quiet, resolvedPassword, tls, tray, handoverPayload });
  }

  const { entry } = spawnDetachedServer({
    pkgRoot,
    mode,
    port,
    host,
    launchMode: 'daemon',
    resolvedPassword,
    tls,
    tray,
    handoverPayload,
  });

  if (!quiet && !json) {
    log(`Starting Kabmo (${mode}) on ${entry.url} (pid ${entry.pid})...`);
  }

  const health = await waitForHealth(port, host, undefined, tls);

  if (json) {
    printJson(entry);
    return;
  }

  if (!health) {
    warn(`Server started (pid ${entry.pid}) but the health check did not pass.\nCheck logs: ${entry.logFile}`);
    return;
  }

  ok(`Kabmo ${mode} server ready`);
  log(`  url:   ${entry.url}`);
  log(`  pid:   ${entry.pid}`);
  log(`  logs:  ${entry.logFile}`);
}

function runForeground({ pkgRoot, mode, port, host, quiet, resolvedPassword, tls = false, tray = false, handoverPayload = null }) {
  const invocation = buildServeInvocation({ pkgRoot, mode, port, host, launchMode: 'foreground', tls, tray });
  const { env, payload } = handoverPayload
    ? { env: { ...invocation.env, [PASSWORD_HANDOVER_ENV]: PASSWORD_HANDOVER_STDIN }, payload: handoverPayload }
    : uiPasswordHandover(resolvedPassword, invocation.env);
  const url = `${tls ? 'https' : 'http'}://${probeHost(host)}:${port}`;
  if (!quiet) {
    log(`Running Kabmo (${mode}) in the foreground on ${url} (Ctrl+C to stop)...`);
  }
  const child = Bun.spawn({
    cmd: [invocation.file, ...invocation.args],
    cwd: invocation.cwd,
    // The credential rides stdin, never the environment — see
    // `uiPasswordHandover`. Without one the child keeps the terminal.
    stdin: payload ? 'pipe' : 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env,
  });
  if (payload && child.stdin) {
    child.stdin.write(payload);
    child.stdin.end();
  }
  wireChildProcessLifecycle(child, process, 5000);
  return new Promise((resolve) => {
    void child.exited.then(resolve);
  });
}
