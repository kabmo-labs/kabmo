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
 * `@semantic-release/git` pushes to `repositoryUrl`, which semantic-release
 * reads from package.json's `repository` field — NOT from the clone's `origin`.
 * A rehearsal in a scratch clone therefore still writes to the REAL remote.
 * Measured: a scratch-clone run pushed two release commits and two tags to
 * `github.com/kabmo-labs/kabmo`, because the scratch remote was never
 * consulted. Nothing was published (the tag push raises no workflow run, and
 * this pipeline does not publish), but the remote branch moved and had to be
 * reverted by hand.
 *
 * A rehearsal belongs on `--dry-run`, which skips every `prepare` step. This
 * guard is what makes forgetting it a refusal instead of a push.
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
      'This runner PUSHES: @semantic-release/git pushes to the repository URL in',
      "package.json, which is the real remote — a scratch clone's origin is never",
      'consulted, so a "rehearsal" here would move the real branch and create tags.',
      '',
      'To rehearse, use --dry-run (it skips every prepare step and pushes nothing).',
      'To cut a release from this machine on purpose, set',
      'KABMO_RELEASE_ALLOW_NON_CI=1.',
    ].join('\n'),
  );
}
