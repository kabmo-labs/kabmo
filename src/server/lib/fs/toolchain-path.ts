/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Looking a binary up the way a SPAWN will find it.
 *
 * A login-entry launch hands the server a minimal PATH. Measured on this
 * machine: `~/Library/LaunchAgents/dev.kabmo.tray.plist` carries no
 * `EnvironmentVariables`, so launchd's default `/usr/bin:/bin:/usr/sbin:/sbin`
 * is what the server searched — `Bun.which('npx')` answered null while
 * `/opt/homebrew/bin/npx` and `~/.bun/bin/omp` were installed. Every harness
 * whose launch line starts with `npx` therefore read "not installed" on the
 * first boot after login, and the same build answered `ready` when Kabmo was
 * started from a terminal (which inherits the shell's PATH). A restart spawned
 * BY that server inherited the same minimal PATH, so it did not repair it.
 *
 * The spawn side already repairs this (`withToolchainPath`, used by the ACP
 * stdio transport), which is why "not installed" and "runs fine" could both be
 * true. This is the same repair for the RESOLUTION side, so a lookup here
 * answers what `Bun.which` answers in the user's own shell.
 *
 * `env`/`platform` are parameters for the reason `childEnv` takes them: the
 * repair is only testable if a suite can hand in a PATH that lacks the
 * toolchain directories.
 */

import { withToolchainPath } from '@kabmo-labs/kabmo-sdk';

/** The PATH a lookup (and a child) should search: the inherited one, repaired. */
export function toolchainPath(
  env: Record<string, string | undefined> = Bun.env,
  platform: string = process.platform,
): string {
  return withToolchainPath(env, platform).PATH ?? '';
}

/**
 * `Bun.which` over the repaired PATH. Null when the binary is nowhere the
 * user's shell would look either.
 */
export function whichOnToolchainPath(
  binary: string,
  env: Record<string, string | undefined> = Bun.env,
  platform: string = process.platform,
): string | null {
  return Bun.which(binary, { PATH: toolchainPath(env, platform) });
}
