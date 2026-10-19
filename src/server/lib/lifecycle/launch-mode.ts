/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * How this server was launched — the fact that decides whether an update may
 * replace it.
 *
 * The marker travels as an argv flag, never as an environment variable. Env is
 * inherited by every descendant, so a server started from a shell *inside* an
 * Kabmo tree — the chamber's own terminal panel runs commands with the
 * server's environment — would inherit `daemon` and then be swapped out by the
 * next update, killing a `bun run dev` loop Kabmo does not own. argv
 * belongs to the process alone.
 */

import type { InstanceLaunchMode } from '@/server/lib/lifecycle/instance';

/** The argv flag the CLI appends to every server it spawns. */
const LAUNCH_MODE_FLAG = '--launch-mode=';

/**
 * The argv entry for `mode`. Paired with `resolveLaunchMode`, so the flag
 * spelling exists in exactly one place for the writer and the reader.
 */
export function launchModeArg(mode: InstanceLaunchMode): string {
  return `${LAUNCH_MODE_FLAG}${mode}`;
}

/**
 * Launch mode of a server invocation. Only the CLI passes the flag, so a
 * `bun run dev`, a `bun run start`, a manual run and an externally supervised
 * process all resolve to `direct` — the mode that is left alone.
 */
export function resolveLaunchMode(argv: readonly string[] = Bun.argv): InstanceLaunchMode {
  const flag = argv.find((arg) => arg.startsWith(LAUNCH_MODE_FLAG));
  const value = flag?.slice(LAUNCH_MODE_FLAG.length);
  return value === 'daemon' || value === 'foreground' ? value : 'direct';
}

/**
 * Whether the CLI owns this instance's lifecycle — the one question every
 * command that would end a server asks: `restart`/`update` may replace it, and
 * `stop` stops it by default.
 *
 * A `direct` server runs under a launcher the CLI does not own, and that
 * launcher exits with its child: `bun run dev` is a supervisor process whose
 * only job is to mirror the script it spawned, so signalling the server ends
 * the user's dev loop with it. Leaving those alone by default is what keeps
 * `ompchamber stop` from killing a loop it did not start; an explicit
 * `--port <port>` (or `--all`) still ends one, deliberately.
 */
export function isCliManaged(launchMode: string | null | undefined): boolean {
  return launchMode === 'daemon' || launchMode === 'foreground';
}

/**
 * Why an instance the CLI does not own is left alone, without the action. Each
 * command that would end a server appends its own next step, so the two cannot
 * describe the same `launchMode` differently.
 */
export function unmanagedReason(launchMode: string | null | undefined): string {
  if (launchMode === 'direct') return 'runs from source (`bun run dev` / `bun run start`)';
  return 'is not managed by the ompchamber CLI';
}
