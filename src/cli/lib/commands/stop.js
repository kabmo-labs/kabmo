// `ompchamber stop` — stop Kabmo instances.
//
// Scope follows OWNERSHIP, the same rule `restart` and `update` apply. By
// default only the instances the CLI started are stopped, because a server
// running from source is supervised by a launcher the CLI does not own and
// that launcher exits with the child it spawned: `bun run dev` is a process
// whose whole job is to mirror the script under it, so signalling the server
// takes the user's dev loop down with it. `--port <port>` and `--all` are the
// explicit forms that do end one — naming an instance is a deliberate call,
// not a default.

import { listLiveInstances, findLiveInstance } from '@/cli/lib/runtime.js';
import { stopInstance } from '@/cli/lib/stop-instance.js';
import { STOP_TIMEOUT_MS } from '@/cli/lib/process-lifecycle.js';
import { ok, warn, error, log, printJson, isJson, isQuiet } from '@/cli/lib/output.js';
import { unmanagedReason } from '@/server/lib/lifecycle/launch-mode';
import { partitionStopTargets } from '@/cli/lib/stop-scope.js';

function explicitPort(options) {
  const raw = options?.port;
  if (raw === null || raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** How to end an instance the default scope leaves alone. */
function stopHint(port) {
  return `stop it with \`ompchamber stop --port ${port}\` or \`ompchamber stop --all\``;
}

export async function run(options) {
  const json = isJson();
  const quiet = isQuiet();
  const requested = explicitPort(options);
  // `--all` is the explicit spelling of "every instance, whoever started it".
  const explicitScope = requested !== null || Boolean(options?.all);

  const live = requested !== null
    ? [await findLiveInstance(requested)].filter(Boolean)
    : await listLiveInstances();
  const { targets, skipped } = partitionStopTargets(live, explicitScope);
  const skippedReport = skipped.map((entry) => ({ port: entry.port, pid: entry.pid, launchMode: entry.launchMode }));

  if (!json && !quiet) {
    for (const entry of skipped) {
      log(`Skipping Kabmo on port ${entry.port} (pid ${entry.pid}): it ${unmanagedReason(entry.launchMode)} — ${stopHint(entry.port)}.`);
    }
  }

  if (targets.length === 0) {
    if (json) {
      printJson({ stopped: [], skipped: skippedReport });
      return;
    }
    if (skipped.length === 0) {
      warn(requested === null
        ? 'No running Kabmo instances found.'
        : `No running Kabmo instance on port ${requested}.`);
    }
    return;
  }

  const stopped = [];
  let failures = 0;
  for (const entry of targets) {
    const gone = await stopInstance(entry, { timeoutMs: STOP_TIMEOUT_MS });
    stopped.push({ port: entry.port, pid: entry.pid, stopped: gone });
    if (json) continue;
    if (gone) {
      ok(`Stopped Kabmo on port ${entry.port} (pid ${entry.pid}).`);
    } else {
      // A failure the caller must be able to see: the instance is still
      // serving, its record is still on disk (so the next `status` finds it),
      // and this command's exit code says the stop did not happen. Verified
      // before the fix: this branch was unreachable on Windows, because
      // `stopInstance` answered `true` for a process it never signalled.
      failures += 1;
      warn(`Kabmo on port ${entry.port} (pid ${entry.pid}) is still running — the stop did not take.`);
    }
  }

  if (json) {
    printJson({ stopped, skipped: skippedReport });
    if (failures > 0) process.exitCode = 1;
    return;
  }

  if (failures > 0) {
    error(
      `Could not stop ${failures} instance${failures === 1 ? '' : 's'}.`
      + ` The instance record is kept, so \`ompchamber status\` still reports it.`,
    );
    process.exitCode = 1;
  }
}
