/**
 * The published packages, in the one place their release identities live.
 *
 * `release/packages.mjs` reads this table, `release/release-packages.mjs` reads
 * it, and `release/packages.test.js` asserts it against the tree — so a
 * directory, a tag prefix or a manifest name can only be stated here. A second
 * copy is how a package gets released under the wrong tag, which publishes a
 * version nobody asked for and cannot be undone.
 *
 * `name` is duplicated from the package's own manifest on purpose: the tag
 * prefix and the manifest name are two facts that must agree, and
 * `packages.test.js` is what holds them together. Reading the manifest here
 * would make the agreement untestable.
 *
 * **Order is load-bearing.** `@kabmo-labs/kabmo-ui` declares
 * `"@kabmo-labs/kabmo-sdk": "workspace:*"`, which Bun rewrites to an exact
 * version at publish time from the version `bun.lock` records for the workspace
 * package — not from the manifest on disk. So a `ui` release pins whatever SDK
 * version the lock says, which is why the version plugin refreshes the lock and
 * why `release-packages.mjs` releases in this order and stops on the first
 * failure: a `ui` release must never follow a failed SDK release, or it
 * publishes a package whose dependency is not the one it was built against.
 */
export const RELEASE_PACKAGES = [
  {
    /** Directory under `packages/`, which is also the tag's prefix. */
    dir: 'packages/kabmo-sdk',
    name: '@kabmo-labs/kabmo-sdk',
  },
  {
    dir: 'packages/kabmo-ui',
    name: '@kabmo-labs/kabmo-ui',
  },
];

/** The tag prefix a package is released under, e.g. `kabmo-sdk`. */
export function tagPrefix(entry) {
  return entry.dir.replace(/^packages\//, '');
}

/**
 * Refuse to cut a release outside CI unless the caller insists.
 *
 * The runner COMMITS and PUSHES: `release/packages-commit.js` moves `main` and
 * pushes the package tags to `origin`, and creates the GitHub release pages. A
 * local run in a real checkout therefore releases for real.
 *
 * The per-package semantic-release runs this replaced were worse: the git plugin
 * pushed to `repositoryUrl`, read from package.json's `repository` field rather
 * than from the clone's `origin`, so a rehearsal in a scratch clone wrote to the
 * REAL remote — measured, a "scratch" run pushed two release commits and two
 * tags to `github.com/kabmo-labs/kabmo` and the branch had to be reverted by
 * hand.
 *
 * A rehearsal belongs on `--dry-run`, which writes nothing at all: no version, no
 * changelog, no lockfile, no commit. This guard is what makes forgetting it a
 * refusal instead of a push.
 *
 * @param {Record<string, string|undefined>} env
 */
export function assertReleaseEnvironment(env) {
  if (env.GITHUB_ACTIONS === 'true' || env.KABMO_RELEASE_ALLOW_NON_CI === '1') {
    return;
  }

  throw new Error(
    [
      'Refusing to cut a release outside CI.',
      '',
      'This runner PUSHES: it commits the version bump, moves `origin/main`,',
      'pushes the package tags and creates their GitHub releases.',
      '',
      'To rehearse, use --dry-run (it writes nothing and pushes nothing).',
      'To cut a release from this machine on purpose, set',
      'KABMO_RELEASE_ALLOW_NON_CI=1.',
    ].join('\n'),
  );
}
