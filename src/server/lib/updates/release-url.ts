/**
 * Where OMPChamber's release notes live.
 *
 * Two questions, two sources, deliberately. The VERSION an install can move to
 * comes from npm (see ./npm) — that is the channel `bun add -g ompchamber@…`
 * installs from. The NOTES are published on GitHub: every release tag carries the
 * same `CHANGELOG.md` section the popup renders, with its compare range, commit
 * hashes and contributor credits, and the release page is where a reader can
 * follow them. So the popup's links point at GitHub while the version it
 * announces comes from the registry.
 */

/**
 * OMPChamber's own repository.
 *
 * Flip this to `kabmo-labs/kabmo` in the same change that transfers the
 * repository; every release and changelog link is built from it.
 */
export const REPO = 'rajebdev/ompchamber';

/** The releases index. */
export const RELEASES_URL = `https://github.com/${REPO}/releases`;

/** One release tag's page — the notes for a single version. */
export function releaseTagUrl(version: string): string {
  return `${RELEASES_URL}/tag/v${version}`;
}
