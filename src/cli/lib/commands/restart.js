// `kabmo restart` — stop live instances, then serve again.
//
// Scoping matches `status` and `stop`: without `--port` every live instance is
// considered, and `--port <port>` restricts the restart to that one. With
// nothing running, the command is simply `serve`.
//
// Instances the CLI did not start are left alone, exactly as `kabmo update`
// leaves them: `bun run dev` and `bun run start` own their own process, so
// replacing it would break a loop Kabmo does not manage. `kabmo stop
// --port <port>` (or `--all`) is the deliberate way to end one.

import { findLiveInstance, listLiveInstances } from '@/cli/lib/runtime.js';
import { stopInstance } from '@/cli/lib/stop-instance.js';
import { STOP_TIMEOUT_MS } from '@/cli/lib/process-lifecycle.js';
import { log, warn, isJson, isQuiet } from '@/cli/lib/output.js';
import { run as runServe } from '@/cli/lib/commands/serve.js';
import { restartAuthWarning, restartServeOptions } from '@/cli/lib/restart-scope.js';
import { skipRestartNote } from '@/server/lib/lifecycle/restart';
import { isCliManaged } from '@/server/lib/lifecycle/launch-mode';
import { PASSWORD_HANDOVER_ENV, PASSWORD_HANDOVER_STDIN } from '@/shared/lib/auth/handover';

function explicitPort(options) {
  const raw = options?.port;
  if (raw === null || raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The credential payload a restarting server wrote to our stdin, verbatim.
 *
 * Null when no marker was set — a plain `kabmo restart` from a shell has a
 * terminal there, and reading it would hang the command. `Bun.stdin.text()`
 * ends at EOF, which the writer always produces.
 */
async function readStdinHandoverPayload() {
  if (Bun.env[PASSWORD_HANDOVER_ENV] !== PASSWORD_HANDOVER_STDIN) return null;
  delete Bun.env[PASSWORD_HANDOVER_ENV];
  try {
    const text = await Bun.stdin.text();
    return text.trim().length > 0 ? text : null;
  } catch {
    return null;
  }
}

export async function run(options, ctx) {
  const json = isJson();
  const quiet = isQuiet();
  const requested = explicitPort(options);

  // A restarting SERVER hands its already-hashed credential over on stdin (see
  // `lib/lifecycle/restart.ts`). It must survive this process and reach the
  // server spawned below, or every restart would silently drop authentication:
  // measured, a run started with `--ui-password` came back `required: false`.
  // The payload is forwarded verbatim — this process never needs to parse it.
  const handoverPayload = await readStdinHandoverPayload();

  const targets = requested !== null
    ? [await findLiveInstance(requested)].filter(Boolean)
    : await listLiveInstances();

  if (targets.length === 0) return runServe({ ...options, handoverPayload }, ctx);

  let failures = 0;
  for (const live of targets) {
    if (!isCliManaged(live.launchMode)) {
      if (!json && !quiet) log(`Skipping Kabmo on port ${live.port}: ${skipRestartNote(live.launchMode)}.`);
      continue;
    }

    if (!json && !quiet) log(`Stopping Kabmo on port ${live.port} (pid ${live.pid})...`);
    // A stop that did not take must not be followed by a start: the port is
    // still held, so `serve` would fail on the port guard and read as the
    // restart's own failure. Report it here, where the cause is.
    const gone = await stopInstance(live, { timeoutMs: STOP_TIMEOUT_MS });
    if (!gone) {
      warn(`Kabmo on port ${live.port} (pid ${live.pid}) is still running — not restarting it.`);
      failures += 1;
      continue;
    }

    // Reuse the recorded port/host/mode/flags so an instance started on a
    // non-default port, bound to the LAN, serving TLS or showing a tray icon
    // comes back the way it was found. Production is the default, so only a
    // recorded dev instance asks for `--dev`.
    const authWarning = restartAuthWarning(live, handoverPayload);
    if (authWarning && !json) warn(authWarning);

    await runServe({ ...restartServeOptions(live, options), handoverPayload }, ctx);
  }

  if (failures > 0) process.exitCode = 1;
}
