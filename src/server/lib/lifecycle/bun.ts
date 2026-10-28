/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Bun binary to spawn child processes with.
 *
 * The server is usually itself Bun, so `process.execPath` is the most
 * trustworthy answer — it is the exact runtime this install was started with.
 * A host that is not Bun falls back to a PATH lookup, and finally to the
 * literal `bun`, which lets the child resolve it from its own environment.
 */
export function resolveBunBin(): string {
  const execPath = process.execPath;
  // `bun.exe` on Windows: the launcher carries the extension there, and without
  // it this fell through to a PATH lookup for a runtime already running.
  if (/(^|[\\/])bun(\.exe)?$/.test(execPath)) return execPath;
  return Bun.which('bun') ?? 'bun';
}
