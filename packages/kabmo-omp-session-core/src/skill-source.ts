/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Skillshare package behind an omp discovery source.
 *
 * omp reports a registry skill as `skillshare:@scope/name@1.2.3` — the package
 * spec plus the installed version. The catalog addresses packages, so the
 * version has to come off before the two can be compared; matching on the
 * display name instead would treat two packages that ship a skill with the same
 * name as one install.
 */
export function skillsharePackage(source: string | undefined): string | null {
  if (!source?.startsWith('skillshare:')) return null;
  const spec = source.slice('skillshare:'.length);
  const at = spec.lastIndexOf('@');
  return at > 0 ? spec.slice(0, at) : spec;
}
