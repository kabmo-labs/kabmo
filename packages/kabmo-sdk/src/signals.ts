/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The label for the signal that ended a child process.
 *
 * `Bun.Subprocess.signalCode` is `NodeJS.Signals | number | null` since
 * `bun-types` 1.4.4 — widened from `NodeJS.Signals | null` because Bun reports
 * a signal by NAME when it has one and by NUMBER when it does not (a Linux
 * real-time signal, for example). Every consumer of ours stores the label in a
 * `string | null` field: the terminal's exit frame, a Runner run's `signal`,
 * `ShellResult.signalCode`, the omp child's exit info. Narrowing at each of them
 * is five copies of the same rule, and the five would drift.
 *
 * A NUMBER has no name to recover: the numeric identity of a real-time signal is
 * what the OS reports, and the standard signal numbers differ between Linux and
 * macOS (SIGUSR1 is 10 on Linux and 30 on Darwin), so a built-in name table
 * would be wrong on one of them. It is rendered as `SIG<n>` — a label, not a
 * claim that a signal of that name exists.
 *
 * This lives in the SDK for the reason `stripKabmoHostEnv` does: the host and a
 * plugin's own server half both spawn processes of the user's, and they cannot
 * share Kabmo source. Pure, with no imports — the SDK root is bundled for the
 * browser too, so a `node:os` lookup is not available here.
 */

/** A process's terminating signal as a label, or null when it was not signalled. */
export function signalName(value: NodeJS.Signals | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  return `SIG${value}`;
}
