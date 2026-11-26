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
 * **Order is the publish order, not a topological one.** Every entry is
 * released in this array's order. `@kabmo-labs/kabmo-ui` pins
 * `"@kabmo-labs/kabmo-sdk": "workspace:*"`, and the family packages
 * (`kabmo-acp`, `kabmo-omp`, `kabmo-harness`, `kabmo-chat`, `kabmo-session`)
 * pin each other in a cycle, so no order can make every pin already published.
 * Bun rewrites every workspace spec to the exact version `bun.lock` records at
 * publish time, which is why the version plugin refreshes the lock and
 * `release-packages.mjs` stops on the first failure rather than publishing the
 * rest against a missing dependency.
 */
export const RELEASE_PACKAGES = [
  {
    dir: 'packages/kabmo-sdk',
    name: '@kabmo-labs/kabmo-sdk',
  },
  {
    dir: 'packages/kabmo-ui',
    name: '@kabmo-labs/kabmo-ui',
  },
  {
    dir: 'packages/kabmo-format',
    name: '@kabmo-labs/kabmo-format',
  },
  {
    dir: 'packages/kabmo-guards',
    name: '@kabmo-labs/kabmo-guards',
  },
  {
    dir: 'packages/kabmo-paths',
    name: '@kabmo-labs/kabmo-paths',
  },
  {
    dir: 'packages/kabmo-runtime-flags',
    name: '@kabmo-labs/kabmo-runtime-flags',
  },
  {
    dir: 'packages/kabmo-db',
    name: '@kabmo-labs/kabmo-db',
  },
  {
    dir: 'packages/kabmo-auth',
    name: '@kabmo-labs/kabmo-auth',
  },
  {
    dir: 'packages/kabmo-fs',
    name: '@kabmo-labs/kabmo-fs',
  },
  {
    dir: 'packages/kabmo-workspace',
    name: '@kabmo-labs/kabmo-workspace',
  },
  {
    dir: 'packages/kabmo-git',
    name: '@kabmo-labs/kabmo-git',
  },
  {
    dir: 'packages/kabmo-settings',
    name: '@kabmo-labs/kabmo-settings',
  },
  {
    dir: 'packages/kabmo-provider-contracts',
    name: '@kabmo-labs/kabmo-provider-contracts',
  },
  {
    dir: 'packages/kabmo-realtime-signals',
    name: '@kabmo-labs/kabmo-realtime-signals',
  },
  {
    dir: 'packages/kabmo-process',
    name: '@kabmo-labs/kabmo-process',
  },
  {
    dir: 'packages/kabmo-session',
    name: '@kabmo-labs/kabmo-session',
  },
  {
    dir: 'packages/kabmo-harness',
    name: '@kabmo-labs/kabmo-harness',
  },
  {
    dir: 'packages/kabmo-http',
    name: '@kabmo-labs/kabmo-http',
  },
  {
    dir: 'packages/kabmo-idle-reaper',
    name: '@kabmo-labs/kabmo-idle-reaper',
  },
  {
    dir: 'packages/kabmo-live-sessions',
    name: '@kabmo-labs/kabmo-live-sessions',
  },
  {
    dir: 'packages/kabmo-mcp-contracts',
    name: '@kabmo-labs/kabmo-mcp-contracts',
  },
  {
    dir: 'packages/kabmo-model-contracts',
    name: '@kabmo-labs/kabmo-model-contracts',
  },
  {
    dir: 'packages/kabmo-refresh-cadence',
    name: '@kabmo-labs/kabmo-refresh-cadence',
  },
  {
    dir: 'packages/kabmo-rpc-lines',
    name: '@kabmo-labs/kabmo-rpc-lines',
  },
  {
    dir: 'packages/kabmo-worktree',
    name: '@kabmo-labs/kabmo-worktree',
  },
  {
    dir: 'packages/kabmo-omp',
    name: '@kabmo-labs/kabmo-omp',
  },
  {
    dir: 'packages/kabmo-chat',
    name: '@kabmo-labs/kabmo-chat',
  },
  {
    dir: 'packages/kabmo-app-contracts',
    name: '@kabmo-labs/kabmo-app-contracts',
  },
  {
    dir: 'packages/kabmo-acp',
    name: '@kabmo-labs/kabmo-acp',
  },
  {
    dir: 'packages/kabmo-bytes',
    name: '@kabmo-labs/kabmo-bytes',
  },
  {
    dir: 'packages/kabmo-platform',
    name: '@kabmo-labs/kabmo-platform',
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
