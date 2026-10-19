// Runtime helpers for the OMPChamber CLI: instance discovery, process identity,
// server entry resolution, health probing and detached spawning.
//
// The instance record is written by the server that owns the port (see
// src/server/lib/lifecycle/instance.ts), not by the CLI that spawned it, so a
// server started by `bun run dev` or by `--foreground` is as discoverable as a
// detached one. Discovery combines that record with a live `/api/health` probe:
// the probe covers servers started outside the CLI, the record covers servers
// that are alive but deaf (starting up, hung).

import fs from 'node:fs';

import { ensureDataDirs, getLogFilePath } from '@/cli/lib/paths.js';
import { uiPasswordHandover } from '@/cli/lib/ui-password.js';
import { PASSWORD_HANDOVER_ENV, PASSWORD_HANDOVER_STDIN } from '@/shared/lib/auth/handover';
import { getProcessState, isProcessAlive } from '@/server/lib/lifecycle/identity';
import { launchModeArg } from '@/server/lib/lifecycle/launch-mode';
import { TLS_FLAG } from '@/server/lib/lifecycle/tls';
import { TRAY_FLAG } from '@/server/lib/lifecycle/argv-flags';
import { listInstanceRecords, readInstanceRecord, removeInstanceRecord } from '@/server/lib/lifecycle/instance';
import { fetchHealth, probeHost } from '@/server/lib/lifecycle/probe';
import { joinPath, homeDir } from '@/cli/lib/path-utils.js';

const HEALTH_INTERVAL_MS = 500;
const HEALTH_TIMEOUT_MS = 30_000;

/**
 * CLI shape of a live instance, so records and probed servers print the same.
 *
 * No `url`: the scheme depends on whether the listener speaks TLS, which is only
 * knowable from its health payload — so `status` builds the URL from that rather
 * than trusting a value assembled before the probe ran.
 */
function toLiveInstance({ pid, port, host, mode, launchMode, tray, tls, auth, startedAt, source }) {
  const resolvedHost = host || 'localhost';
  return {
    pid,
    port,
    host: resolvedHost,
    mode: mode ?? 'unknown',
    launchMode: launchMode ?? 'unknown',
    // Carried so a restart can reproduce the invocation: `restart` and `update`
    // spawn a NEW `serve`, and their own argv says nothing about the flags the
    // original run had. Without these, an update dropped the tray icon (and TLS)
    // of an instance started with `--tray` / `--tls`.
    tray: tray === true,
    tls: tls === true,
    auth: auth === true,
    startedAt,
    source: source ?? 'registry',
    logFile: getLogFilePath(port),
  };
}

/**
 * A recorded PID counts as the instance only while it is alive *and* still
 * identifiable: a recycled PID must not resurrect a dead instance. `unknown`
 * (identity unreadable on this platform) is accepted so Windows keeps working.
 */
function isRecordLive(record) {
  if (!record) return false;
  return isProcessAlive(record.pid) && getProcessState(record.pid) !== 'mismatched';
}

/**
 * Every recorded instance whose process is still alive. Records left behind by
 * a killed server (SIGKILL skips its cleanup handler) are pruned here, so a
 * recycled PID can never be reported as a running instance.
 */
export async function listLiveInstances() {
  const live = [];
  for (const record of listInstanceRecords()) {
    if (isRecordLive(record)) live.push(toLiveInstance(record));
    else removeInstanceRecord(record.port);
  }
  // Directory order is filesystem-dependent; a port-ordered report is stable
  // across runs and keeps multi-instance output readable.
  live.sort((a, b) => a.port - b.port);
  return live;
}

/**
 * The live instance on `port`, or the first live instance when no port is
 * given. Falls back to a health probe for servers that never wrote a record.
 */
export async function findLiveInstance(port) {
  if (port === null || port === undefined) {
    const [live] = await listLiveInstances();
    return live ?? null;
  }

  const record = readInstanceRecord(port);
  if (isRecordLive(record)) return toLiveInstance(record);
  if (record) removeInstanceRecord(port);

  const health = await fetchHealth(port, record?.host);
  if (!health || typeof health.pid !== 'number' || !isProcessAlive(health.pid)) return null;
  return toLiveInstance({
    pid: health.pid,
    port,
    host: health.host ?? record?.host,
    mode: health.mode,
    launchMode: health.launchMode ?? record?.launchMode,
    // A server started outside the CLI writes no record the CLI trusts, but it
    // still reports its own flags. Absent means false, never inherited.
    tray: health.tray ?? record?.tray,
    tls: health.tls ?? record?.tls,
    auth: health.authEnabled ?? record?.auth,
    startedAt: health.startedAt,
    source: 'probe',
  });
}

function isBun(candidate) {
  if (!candidate || !fs.existsSync(candidate)) return false;
  const probe = Bun.spawnSync([candidate, '--version']);
  return probe.success;
}

/**
 * Locate the Bun runtime. The server imports `@/...` path aliases and ships as
 * TypeScript, so it must run under Bun rather than whatever Node happens to be
 * executing this CLI.
 */
export function resolveBunBin() {
  const override = Bun.env.OMPCHAMBER_BUN;
  if (isBun(override)) return override;

  const execDir = process.execPath;
  // `bun` and `bun.exe`: on Windows the launcher carries the extension, and the
  // path separator there is `\` — both already covered by the character class.
  if (/(^|[\\/])bun(\.exe)?$/.test(execDir) && isBun(execDir)) return execDir;

  const candidates = [
    joinPath(homeDir(), '.bun', 'bin', 'bun'),
    joinPath(homeDir(), '.bun', 'bin', 'bun.exe'),
    '/opt/homebrew/bin/bun',
    '/usr/local/bin/bun',
    '/usr/bin/bun',
  ];
  for (const candidate of candidates) {
    if (isBun(candidate)) return candidate;
  }

  const found = Bun.which('bun');
  if (isBun(found)) return found;

  throw new Error('Could not locate the Bun runtime. Install it from https://bun.sh and retry.');
}

/**
 * Build the executable + args + env for a dev or prod server run.
 *
 * Bun executes the TypeScript entry directly in both modes, so dev and prod
 * differ only by NODE_ENV — the client bundle in `dist/client` is required by
 * the SSR shell either way. `--ompchamber-server` is an identity marker: it
 * makes this process recognizable in `ps` output, which is how a starting
 * server decides whether a busy port belongs to OMPChamber before signalling
 * anything. The launch mode rides along as argv (`--launch-mode=`), never as an
 * environment variable: env is inherited by descendants, so a `bun run dev`
 * started from an OMPChamber shell would otherwise be labelled `daemon` and
 * replaced by the next update.
 */
export function buildServeInvocation({ pkgRoot, mode, port, host, launchMode = 'daemon', tls = false, tray = false }) {
  // Production runs the built server: `bun run build` bundles `src/server/index.ts`
  // into `dist/client/index.js`, and that bundle carries the HTML route and the
  // hashed assets beside it. Development runs the source, which is what gives
  // `--hot` something to reload.
  const entry = mode === 'prod'
    ? joinPath(pkgRoot, 'dist', 'client', 'index.js')
    : joinPath(pkgRoot, 'src', 'server', 'index.ts');
  if (!fs.existsSync(entry)) {
    throw new Error(mode === 'prod'
      ? `No production build found at ${entry}. Run \`bun run build\` and retry.`
      : `Could not locate the server entry at ${entry}.`);
  }
  return {
    file: resolveBunBin(),
    // `--tls` and `--tray` travel as argv, like `--launch-mode`: env is inherited
    // by every descendant, so a server started inside the chamber's own terminal
    // would otherwise inherit the choice.
    args: [entry, '--ompchamber-server', '--kabmo-server', launchModeArg(launchMode), ...(tls ? [TLS_FLAG] : []), ...(tray ? [TRAY_FLAG] : [])],
    // Both modes run from the package root. The built server's HTML bundle
    // resolves its asset paths against the cwd, and the build emits them under
    // `dist/client/` from that same root — while everything else the server
    // does (the SQLite file, workspace roots, `public/`) is cwd-relative too,
    // so moving the cwd into the output directory would relocate all of it.
    cwd: pkgRoot,
    env: {
      ...Bun.env,
      NODE_ENV: mode === 'prod' ? 'production' : 'development',
      PORT: String(port),
      HOST: host,
    },
  };
}

/**
 * Spawn a detached server, stream its output to the per-port log file and
 * return the CLI-facing entry description.
 *
 * The instance record is *not* written here: the server writes it once it
 * actually owns the port, so a spawn that fails (port lost to something else)
 * cannot leave a record pointing at a process that never served.
 */
export function spawnDetachedServer({ pkgRoot, mode, port, host, launchMode = 'daemon', resolvedPassword = null, tls = false, tray = false, handoverPayload = null }) {
  ensureDataDirs();
  const logFile = getLogFilePath(port);
  const fd = fs.openSync(logFile, 'a');
  const invocation = buildServeInvocation({ pkgRoot, mode, port, host, launchMode, tls, tray });
  // A payload from a restarting server wins: it is already hashed, and the
  // plaintext it stands for no longer exists anywhere.
  const { env, payload } = handoverPayload
    ? { env: { ...invocation.env, [PASSWORD_HANDOVER_ENV]: PASSWORD_HANDOVER_STDIN }, payload: handoverPayload }
    : uiPasswordHandover(resolvedPassword, invocation.env);

  let child;
  try {
    child = Bun.spawn({
      cmd: [invocation.file, ...invocation.args],
      cwd: invocation.cwd,
      // A pipe, not `ignore`: the credential arrives on stdin. `ignore` here
      // would leave a run with a password starting unauthenticated.
      stdin: payload ? 'pipe' : 'ignore',
      stdout: fd,
      stderr: fd,
      // Never argv: a value on the command line is readable by every user on the
      // machine through `ps`, and on Linux through `/proc/<pid>/cmdline`. Never
      // the environment either — the server's `delete Bun.env.X` does not reach
      // the OS environ, so every grandchild would inherit it.
      env,
    });
    if (payload && child.stdin) {
      child.stdin.write(payload);
      // Closed so the server's read ends: it waits for EOF, not a newline.
      child.stdin.end();
    }
    child.unref();
  } finally {
    fs.closeSync(fd);
  }

  return {
    child,
    entry: {
      pid: child.pid,
      port,
      host,
      mode,
      launchMode,
      startedAt: new Date().toISOString(),
      logFile,
      url: `${tls ? 'https' : 'http'}://${probeHost(host)}:${port}`,
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll `/api/health` until a 200 with a JSON body arrives, else null.
 */
export async function waitForHealth(port, host, timeoutMs = HEALTH_TIMEOUT_MS, tls = 'auto') {
  const deadline = Date.now() + Math.max(0, timeoutMs);

  while (Date.now() < deadline) {
    // `fetchHealth` carries the scheme: an explicit boolean when the caller knows
    // (the CLI that just spawned the server), `'auto'` when it does not (status,
    // discovery) — a server started with `--tls` answers nothing on HTTP, so
    // assuming plain HTTP would report a healthy instance as never becoming ready.
    const body = await fetchHealth(port, host, 2000, tls);
    if (body) return body;
    if (Date.now() >= deadline) break;
    await sleep(HEALTH_INTERVAL_MS);
  }
  return null;
}
