/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The architecture a DESKTOP shell runs as, and the artifact it installs itself
 * from.
 *
 * ## Why this exists at all
 *
 * Every desktop artifact is per-architecture (`Kabmo-0.2.0-mac-arm64.zip`,
 * `Kabmo-0.2.0-win-x64-setup.exe`), and the console used to answer a desktop
 * probe with the RELEASE PAGE precisely because it could not know which
 * architecture the window asking was running on. That is correct for a link and
 * useless for a self-update: handing an arm64 reader an x64 installer produces
 * an app that does not launch, and on Windows an installer that refuses with
 * "this installation package could not be opened".
 *
 * So a desktop shell reports its own architecture over the bridge, and the
 * server names the ONE artifact. This module is the vocabulary both ends share,
 * which is what stops the shell, the route and the asset table from spelling
 * `x86_64`, `x64` and `amd64` for the same machine.
 *
 * ## Two spellings, one canonical token
 *
 * A shell reports the CANONICAL token (`arm64` / `x64`) because that is what the
 * client and the route pass around. Each platform's release assets spell its
 * architecture differently — Linux says `x86_64`, macOS and Windows say `x64` —
 * and that mapping lives in ONE table (`SHELL_ASSETS`), on the server, next to
 * the names it has to match. A shell that mapped its own spelling to the asset's
 * would be a second copy of the same fact.
 */

/** A desktop architecture, in the vocabulary the console and the shells share. */
export type ShellArch = 'arm64' | 'x64';

/**
 * Read a canonical arch out of a string, or null.
 *
 * Lenient about the spellings a shell might report (a shell that read
 * `std::env::consts::ARCH` says `x86_64`; one that read
 * `RuntimeInformation.ProcessArchitecture` says `X64`), because a refused arch
 * costs the reader the self-update and buys nothing: the value only chooses
 * between two artifacts of the same product, and the artifact is then verified
 * by the shell before it is installed.
 */
export function parseShellArch(value: string | null | undefined): ShellArch | null {
  if (!value) return null;
  const folded = value.trim().toLowerCase();
  if (folded === 'arm64' || folded === 'aarch64') return 'arm64';
  if (folded === 'x64' || folded === 'x86_64' || folded === 'amd64') return 'x64';
  return null;
}
