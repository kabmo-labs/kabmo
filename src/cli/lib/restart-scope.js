// Restart scope for `ompchamber update`.
//
// Kept separate from the command so the rule is testable without a live server,
// exactly as `stop-scope.js` is for `stop`. The rule is ownership: an update
// replaces this package on disk, so the only instance it may restart is one it
// started — and, crucially, the one it picks must be that instance rather than
// whichever answers first.
//
// The bug this exists to prevent: picking the LOWEST PORT instead of the owned
// one. `bun run dev` on 3000 beside the updated daemon on 3001 (a real layout
// on this machine) made `update` select the dev server, classify it `direct`,
// skip it, and leave the daemon serving the build that was just replaced.

import { isCliManaged } from '@/server/lib/lifecycle/launch-mode';

/**
 * The instances an update restarts. `all` is the `--all` flag: every live
 * instance is considered, and the caller still leaves the unmanaged ones alone.
 *
 * Without `--all`, every CLI-owned instance is a target, because every one of
 * them is serving the build the update just replaced — the command's own
 * contract is "the instances still serving the previous build (the ones the
 * CLI started)", which is plural. `--all` widens the REPORT to the instances
 * the CLI did not start; ownership, not the flag, decides what may be replaced.
 *
 * Only when nothing is owned does the first live instance fall through, so the
 * unmanaged case is still reported rather than silently ignored.
 */
export function selectRestartTargets(instances, all) {
  if (all) return instances;
  const managed = instances.filter((entry) => isCliManaged(entry.launchMode));
  return managed.length > 0 ? managed : instances.slice(0, 1);
}

/**
 * The `serve` options that bring a stopped instance back the way it was found.
 *
 * Every field here comes from the INSTANCE, never from the argv of the command
 * that is restarting it. `ompchamber restart` and `ompchamber update` are their
 * own invocations: their options describe the command, and spreading them into
 * `serve` is what silently dropped `--tray` and `--tls` from the replacement.
 * An instance started with `serve --startup` (whose login entry runs
 * `serve --foreground --tray`) therefore came back after every update with no
 * icon, and a TLS instance came back answering cleartext on the port its
 * browser had bookmarked as https.
 *
 * `foreground` is always false: the replacement is the detached daemon the CLI
 * serves, whatever the original launch mode was — a `foreground` instance was
 * held open by its launcher (launchd), which is gone by the time a restart is
 * spawned, so reproducing `--foreground` here would tie the replacement to a
 * terminal nobody is watching.
 *
 * `--tray`/`--tls` are ADD-ONLY: an explicit flag on the restarting command
 * turns one on, and its absence never turns one off. `restart` has no way to
 * say "explicitly no tray" (the parser defaults both to false), so reading the
 * absence as an instruction would strip the icon from the instance the user
 * asked to restart — the bug this helper exists to fix. Removing one is
 * `stop` followed by `serve` without the flag.
 */
export function restartServeOptions(instance, options = {}) {
  return {
    ...options,
    port: instance.port,
    host: instance.host,
    lan: instance.host === '0.0.0.0',
    dev: instance.mode === 'dev',
    prod: instance.mode === 'prod',
    tray: instance.tray === true || options.tray === true,
    tls: instance.tls === true || options.tls === true,
    foreground: false,
    all: false,
  };
}

/**
 * The warning a restart owes the user when it cannot carry the credential over.
 *
 * A self-restart hands the hashed credential to its replacement, so it keeps
 * working. A MANUAL `ompchamber restart` has nothing to hand over: the original
 * server never stored the password (only an argon2 hash lived in its memory),
 * so the replacement genuinely cannot require it. Before this, that restart
 * came back with authentication silently DISABLED — measured: a run started with
 * `--ui-password` answered `required: false` afterwards, i.e. an open console on
 * a port the user had deliberately protected.
 *
 * `null` when there is nothing to say: an instance that ran without auth, or one
 * whose replacement already received the payload.
 */
export function restartAuthWarning(instance, handoverPayload) {
  if (instance.auth !== true || handoverPayload) return null;
  return `The credential of the instance on port ${instance.port} cannot be recovered — it was never stored, so the replacement starts WITHOUT a password.`
    + ' Start it again with --ui-password to restore it.';
}
