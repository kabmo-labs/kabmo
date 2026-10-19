// Ownership scope for `kabmo stop`.
//
// Kept separate from the command so the rule is testable without a live
// server: the default scope is the instances the CLI started, and only an
// explicit `--port <port>` / `--all` widens it to the ones it did not. That
// distinction is the whole reason this module exists — a server running from
// source sits under a launcher that exits with its child, so stopping it by
// default takes a `bun run dev` loop down with it.

import { isCliManaged } from '@/server/lib/lifecycle/launch-mode';

/**
 * Split the live instances into the ones `stop` acts on and the ones it leaves
 * alone. `explicit` is true when the user named a port or passed `--all`:
 * naming an instance is a deliberate call, so ownership no longer gates it.
 */
export function partitionStopTargets(instances, explicit) {
  if (explicit) return { targets: instances, skipped: [] };
  return {
    targets: instances.filter((entry) => isCliManaged(entry.launchMode)),
    skipped: instances.filter((entry) => !isCliManaged(entry.launchMode)),
  };
}
