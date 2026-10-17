// `ompchamber restart` — stop live instances, then serve again.
//
// Scoping matches `status` and `stop`: without `--port` every live instance is
// considered, and `--port <port>` restricts the restart to that one. With
// nothing running, the command is simply `serve`.
//
// Instances the CLI did not start are left alone, exactly as `ompchamber update`
// leaves them: `bun run dev` and `bun run start` own their own process, so
// replacing it would break a loop OMPChamber does not manage. `ompchamber stop
// --port <port>` (or `--all`) is the deliberate way to end one.

import { findLiveInstance, listLiveInstances } from '@/cli/lib/runtime.js';
import { stopInstance } from '@/cli/lib/stop-instance.js';
import { STOP_TIMEOUT_MS } from '@/cli/lib/process-lifecycle.js';
import { log, warn, isJson, isQuiet } from '@/cli/lib/output.js';
import { run as runServe } from '@/cli/lib/commands/serve.js';
import { skipRestartNote } from '@/server/lib/lifecycle/restart';
import { isCliManaged } from '@/server/lib/lifecycle/launch-mode';

function explicitPort(options) {
  const raw = options?.port;
  if (raw === null || raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function run(options, ctx) {
  const json = isJson();
  const quiet = isQuiet();
  const requested = explicitPort(options);

  const targets = requested !== null
    ? [await findLiveInstance(requested)].filter(Boolean)
    : await listLiveInstances();

  if (targets.length === 0) return runServe(options, ctx);

  let failures = 0;
  for (const live of targets) {
    if (!isCliManaged(live.launchMode)) {
      if (!json && !quiet) log(`Skipping OMPChamber on port ${live.port}: ${skipRestartNote(live.launchMode)}.`);
      continue;
    }

    if (!json && !quiet) log(`Stopping OMPChamber on port ${live.port} (pid ${live.pid})...`);
    // A stop that did not take must not be followed by a start: the port is
    // still held, so `serve` would fail on the port guard and read as the
    // restart's own failure. Report it here, where the cause is.
    const gone = await stopInstance(live, { timeoutMs: STOP_TIMEOUT_MS });
    if (!gone) {
      warn(`OMPChamber on port ${live.port} (pid ${live.pid}) is still running — not restarting it.`);
      failures += 1;
      continue;
    }

    // Reuse the recorded port/host/mode so an instance started on a non-default
    // port, or bound to the LAN, comes back the way it was found. Production is
    // the default, so only a recorded dev instance asks for `--dev`.
    await runServe(
      {
        ...options,
        port: live.port,
        host: live.host,
        lan: live.host === '0.0.0.0',
        dev: live.mode === 'dev',
        foreground: false,
        all: false,
      },
      ctx,
    );
  }

  if (failures > 0) process.exitCode = 1;
}
