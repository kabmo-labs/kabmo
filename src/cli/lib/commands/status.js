// `kabmo status` — report the live instances, their health and log paths.
//
// Without `--port` every live instance is reported: a CLI server on one port, a
// `bun run dev` server on another and a production server on a third are three
// separate processes, and a status command that showed only the first would
// hide the two you forgot about. `--port <port>` narrows the report to that
// instance.

import { findLiveInstance, listLiveInstances, waitForHealth } from '@/cli/lib/runtime.js';
import { isLoopbackHost, probeHost } from '@/server/lib/lifecycle/probe';
import { log, ok, printJson, isJson } from '@/cli/lib/output.js';

function explicitPort(options) {
  const raw = options?.port;
  if (raw === null || raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatUptime(startedAt) {
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return 'unknown';
  let seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
  const hours = Math.floor(seconds / 3600);
  seconds -= hours * 3600;
  const minutes = Math.floor(seconds / 60);
  seconds -= minutes * 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatHealth(health) {
  if (!health) return 'unreachable';
  const version = health.version ?? 'unknown';
  const mock = health.mock ? ', mock' : '';
  return `ok (version ${version}${mock})`;
}

/**
 * The URL to print for an instance.
 *
 * The scheme comes from the health payload, not from a guess: a TLS listener
 * answers nothing on HTTP, so printing `http://` for it would hand the user a URL
 * that cannot connect.
 */
function instanceUrl(entry) {
  const scheme = entry.health?.tls ? 'https' : 'http';
  return `${scheme}://${probeHost(entry.host)}:${entry.port}`;
}

/**
 * The UI-auth verdict, as one line.
 *
 * Reported beside the bind address because those two facts decide the risk: a
 * network-exposed instance with no password is reachable by anyone who can route
 * to the host, and before this line the only way to learn that was to open a
 * browser and look. `null` (an older server that does not report the field) is
 * said out loud rather than guessed at.
 */
function formatAuth(health, entry) {
  const enabled = health?.authEnabled;
  const host = entry?.host ?? '';
  if (enabled === true) return 'enabled (password required)';
  if (enabled === false) {
    return isLoopbackHost(host)
      ? 'disabled (loopback only)'
      : `disabled — ${host} is network-reachable and anyone can connect`;
  }
  return 'unknown (server does not report it)';
}

/** One block per instance; the field names match the single-instance output. */
function printInstance(entry) {
  log(`  instance: ${entry.port}`);
  log(`  pid:      ${entry.pid}`);
  log(`  port:     ${entry.port}`);
  log(`  url:      ${instanceUrl(entry)}`);
  log(`  mode:     ${entry.mode ?? 'unknown'}`);
  log(`  launch:   ${entry.launchMode ?? 'unknown'}${entry.source ? ` (${entry.source})` : ''}`);
  log(`  uptime:   ${formatUptime(entry.startedAt)}`);
  log(`  health:   ${formatHealth(entry.health)}`);
  log(`  auth:     ${formatAuth(entry.health, entry)}`);
  log(`  tls:      ${entry.health?.tls ? 'on (self-signed)' : 'off — traffic is cleartext'}`);
  // Descriptor pressure, when the server can measure it. A dev server climbs
  // toward 10,240 by holding the client module graph across rebuilds, and past
  // that point every `Bun.spawn` in the process fails at once (the terminal
  // shell, the omp child, git) — this line is the warning that arrives before
  // the breakage instead of after it.
  const fds = entry.health?.fds;
  if (fds) log(`  fds:      ${fds.open}/${fds.limit}${fds.nearCliff ? '  (near the spawn limit — restart this instance)' : ''}`);
  log(`  log:      ${entry.logFile}`);
}

export async function run(options) {
  const json = isJson();
  const requested = explicitPort(options);

  const instances = requested !== null
    ? [await findLiveInstance(requested)].filter(Boolean)
    : await listLiveInstances();

  if (instances.length === 0) {
    if (json) {
      printJson(requested !== null ? { running: false, port: requested } : { running: false, instances: [] });
      return;
    }
    log(requested !== null ? `No Kabmo instance on port ${requested}.` : 'Kabmo is not running.');
    return;
  }

  const reported = [];
  for (const entry of instances) {
    // `'auto'`, not `false`: `status` is asking about an instance it did not
    // start, so it cannot know whether that listener speaks TLS. Trying HTTPS
    // first and falling back to HTTP is the only way to answer for either.
    reported.push({ ...entry, health: await waitForHealth(entry.port, entry.host, 4000, 'auto') });
  }

  if (json) {
    printJson(requested !== null ? { ...reported[0], running: true } : { running: true, instances: reported });
    return;
  }

  ok(reported.length === 1 ? 'Kabmo is running' : `Kabmo is running — ${reported.length} instances`);
  for (const [index, entry] of reported.entries()) {
    if (index > 0) log('');
    printInstance(entry);
  }
}
