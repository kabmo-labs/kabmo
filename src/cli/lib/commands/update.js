// `kabmo update` — replace this install with the latest version on npm.
//
// The installation mechanics live in the shared update engine so the CLI and
// the console's "Update" button do the same thing; this command owns the
// terminal presentation and restarts the instances still serving the previous
// build (the ones the CLI started — a server running from source is left to its
// own launcher).

import { color, configure, error, log, ok, warn, printJson, isJson, isQuiet } from '@/cli/lib/output.js';
import { listLiveInstances } from '@/cli/lib/runtime.js';
import { stopInstance } from '@/cli/lib/stop-instance.js';
import { restartAuthWarning, restartServeOptions, selectRestartTargets } from '@/cli/lib/restart-scope.js';
import { STOP_TIMEOUT_MS } from '@/cli/lib/process-lifecycle.js';
import { run as runServe } from '@/cli/lib/commands/serve.js';
import { skipRestartNote } from '@/server/lib/lifecycle/restart';
import { isCliManaged } from '@/server/lib/lifecycle/launch-mode';
import { resolveInstallContext, resolveKabmoVersion, updateKabmo } from '@/server/lib/updates/install';
import { releaseTagUrl } from '@/server/lib/updates/release-url';

/**
 * Live instances to restart after an update. The selection rule lives in
 * `restart-scope.js` so it is testable without a live server; the doc comment
 * there explains why ownership — not port order — decides.
 */
async function liveInstances(options) {
  return selectRestartTargets(await listLiveInstances(), Boolean(options?.all));
}

async function restartInstances(options, ctx) {
  const restarted = [];
  const skipped = [];
  const failed = [];
  for (const entry of await liveInstances(options)) {
    if (!isCliManaged(entry.launchMode)) {
      skipped.push({ port: entry.port, pid: entry.pid, launchMode: entry.launchMode });
      log(`Skipping Kabmo on port ${entry.port}: ${skipRestartNote(entry.launchMode)}.`);
      continue;
    }

    log(`Restarting Kabmo on port ${entry.port} (pid ${entry.pid})...`);
    // The stop decides whether a start can happen: a server still holding the
    // port would make the spawn fail on the port guard, which reads as the
    // restart's own failure. Name the real cause instead.
    const gone = await stopInstance(entry, { timeoutMs: STOP_TIMEOUT_MS });
    if (!gone) {
      warn(`Kabmo on port ${entry.port} (pid ${entry.pid}) is still running — it was not restarted.`);
      failed.push({ port: entry.port, pid: entry.pid });
      continue;
    }
    const authWarning = restartAuthWarning(entry, options?.handoverPayload);
    if (authWarning) warn(authWarning);
    await runServe(restartServeOptions(entry, options), ctx);
    restarted.push(entry.port);
  }
  return { restarted, skipped, failed };
}

async function runCheck(pkgRoot, json) {
  const info = await resolveKabmoVersion(pkgRoot);
  const context = resolveInstallContext(pkgRoot);

  if (json) {
    printJson({
      current: info.current,
      latest: info.latest,
      updateAvailable: info.updateAvailable,
      installed: true,
      method: context.method,
      reason: context.reason,
      error: info.error,
      releaseUrl: info.latest ? releaseTagUrl(info.latest) : null,
    });
  } else {
    log(`Current version: ${info.current ?? 'unknown'}`);
    if (info.updateAvailable) {
      log(color.yellow(`New version available: ${info.latest}`));
    } else if (!info.error) {
      ok('Already up to date');
    }
    if (info.error) warn(info.error);
  }

  if (info.error) process.exitCode = 1;
}

export async function run(options, ctx) {
  const json = isJson();
  const quiet = isQuiet();
  const pkgRoot = ctx?.pkgRoot ?? process.cwd();
  const force = Boolean(options?.force);
  const shouldRestart = options?.restart !== false;
  const onStage = quiet || json ? undefined : (label) => process.stdout.write(`${color.dim(`\u203a ${label}...`)}\n`);
  const onLine = quiet || json ? undefined : (chunk) => process.stdout.write(chunk);

  if (options?.check) {
    return runCheck(pkgRoot, json);
  }

  const result = await updateKabmo({ force, pkgRoot, onStage, onLine });

  if (json) {
    // Restarting prints through the serve command; silence it so stdout stays
    // one JSON document.
    if (result.success && result.updated && shouldRestart) configure({ json: false, quiet: true });
    const { restarted, skipped, failed } = result.success && result.updated && shouldRestart
      ? await restartInstances(options, ctx)
      : { restarted: [], skipped: [], failed: [] };
    printJson({ ...result, restarted, skipped, failed });
    if (!result.success || failed.length > 0) process.exitCode = 1;
    return;
  }

  if (!result.success) {
    (result.manual ? warn : error)(result.message);
    process.exitCode = 1;
    return;
  }

  ok(result.message);
  if (!result.updated) return;

  if (!shouldRestart) {
    log('Restart the server to apply it: `kabmo restart`.');
    return;
  }

  const { restarted, skipped, failed } = await restartInstances(options, ctx);
  if (restarted.length === 0 && skipped.length === 0) {
    log('No running instance to restart.');
  }
  if (failed.length > 0) process.exitCode = 1;
}
