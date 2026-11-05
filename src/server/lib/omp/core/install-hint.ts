/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The one place the remedy for a missing `omp` binary is written down.
 *
 * Kabmo never installs oh-my-pi by itself: `kabmo serve` means "run the
 * server", and downloading a binary into `$HOME` as a side effect of that is
 * an effect nobody asked for (and in a container or a read-only host it fails
 * half way). The remedy is therefore TEXT, and it has to be the same text
 * everywhere it appears — the startup refusal, `--help`, `status` and
 * `doctor` — because four copies of an install command drift into three
 * different answers about which package and which installer are right.
 *
 * Both commands are listed because they are not equivalent:
 *
 *   - `bun install -g <package>` installs from source with the Bun this
 *     process already requires, and lands `omp` beside `bun` on PATH.
 *   - `curl -fsSL https://omp.sh/install | sh` is omp's own installer: it
 *     downloads a prebuilt binary to `~/.local/bin`, verifies it against the
 *     build service's sha256 and smoke-runs it before reporting success. It
 *     also installs Bun when it is missing, and picks the musl build on
 *     Alpine-style hosts.
 *
 * `probeOmpBin` already searches `~/.local/bin` and `~/.bun/bin`, so either
 * route is found without a restart (see ./cli.ts).
 */

import { OMP_PACKAGE } from '@/server/lib/updates/npm';

/** omp's own installer, which fetches a sha256-verified prebuilt binary. */
export const OMP_INSTALL_SCRIPT_URL = 'https://omp.sh/install';

export interface OmpInstallCommands {
  /** Install from source with the Bun this product already runs on. */
  source: string;
  /** omp's installer: prebuilt binary, published release. */
  binary: string;
}

export function ompInstallCommands(): OmpInstallCommands {
  return {
    source: `bun install -g ${OMP_PACKAGE}`,
    binary: `curl -fsSL ${OMP_INSTALL_SCRIPT_URL} | sh`,
  };
}

/**
 * The install block, indented as a group.
 *
 * Returned as lines rather than one string so each caller can nest it in its
 * own prose without re-deriving the spacing (the startup refusal prints it
 * beside two other paragraphs, `--help` inside a section).
 */
export function ompInstallHintLines(indent = ''): string[] {
  const { source, binary } = ompInstallCommands();
  return [
    `${indent}install omp:  ${source}`,
    `${indent}         or:  ${binary}`,
    `${indent}verify:       omp --version`,
  ];
}
