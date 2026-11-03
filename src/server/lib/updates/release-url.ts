/**
 * Where the release notes live: Kabmo's repository, and oh-my-pi's.
 *
 * Two questions, two sources, deliberately. The VERSION an install can move to
 * comes from npm (see ./npm) — that is the channel `bun add -g kabmo@…`
 * installs from. The NOTES are published on GitHub: every release tag carries the
 * same `CHANGELOG.md` section the popup renders, with its compare range, commit
 * hashes and contributor credits, and the release page is where a reader can
 * follow them. So the popup's links point at GitHub while the version it
 * announces comes from the registry.
 *
 * omp follows the same shape from its own monorepo; the coding-agent package
 * owns the changelog, and its release tags are `v<version>`.
 */

/**
 * Kabmo's own repository — the one every release and changelog link is built
 * from, and the origin a checkout can fast-forward.
 */
export const REPO = 'kabmo-labs/kabmo';

/** The releases index. */
export const RELEASES_URL = `https://github.com/${REPO}/releases`;

/** One release tag's page — the notes for a single version. */
export function releaseTagUrl(version: string): string {
  return `${RELEASES_URL}/tag/v${version}`;
}

/** The Kabmo changelog file, as a reader follows it on GitHub. */
export const CHANGELOG_PAGE = `https://github.com/${REPO}/blob/HEAD/CHANGELOG.md`;

/**
 * oh-my-pi's repository. `omp` publishes from a monorepo, and its release
 * notes live in the coding-agent package's own changelog — the same prose the
 * GitHub release bodies carry.
 */
export const OMP_REPO = 'can1357/oh-my-pi';

/** The package directory inside that monorepo. */
const OMP_PACKAGE_DIR = 'packages/coding-agent';

export const OMP_RELEASES_URL = `https://github.com/${OMP_REPO}/releases`;

/** One omp release tag's page. */
export function ompReleaseTagUrl(version: string): string {
  return `${OMP_RELEASES_URL}/tag/v${version}`;
}

/** The omp changelog file, as a reader follows it on GitHub. */
export const OMP_CHANGELOG_PAGE = `https://github.com/${OMP_REPO}/blob/HEAD/${OMP_PACKAGE_DIR}/CHANGELOG.md`;
