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
 * **Order is load-bearing.** Every entry is released in this array's order, and
 * a dependent package must follow the package it pins. `@kabmo-labs/kabmo-ui`
 * declares `"@kabmo-labs/kabmo-sdk": "workspace:*"`, and the extracted
 * `@kabmo-labs/kabmo-*` packages declare their own workspace dependencies; Bun
 * rewrites each to an exact version at publish time from the version `bun.lock`
 * records. So a dependent release must never follow a failed dependency
 * release, which is why the version plugin refreshes the lock and
 * `release-packages.mjs` stops on the first failure.
 */
export const RELEASE_PACKAGES = [
  {
    /** The published plugin contract. First because `kabmo-fs-toolchain` and
     *  `kabmo-ui` both pin it at publish time. */
    dir: 'packages/kabmo-sdk',
    name: '@kabmo-labs/kabmo-sdk',
  },
  {
    dir: 'packages/kabmo-fs-toolchain',
    name: '@kabmo-labs/kabmo-fs-toolchain',
  },
  {
    dir: 'packages/kabmo-acp-protocol',
    name: '@kabmo-labs/kabmo-acp-protocol',
  },
  {
    dir: 'packages/kabmo-acp-mapper',
    name: '@kabmo-labs/kabmo-acp-mapper',
  },
  {
    dir: 'packages/kabmo-app-contracts',
    name: '@kabmo-labs/kabmo-app-contracts',
  },
  {
    dir: 'packages/kabmo-auth',
    name: '@kabmo-labs/kabmo-auth',
  },
  {
    dir: 'packages/kabmo-fs-child-env',
    name: '@kabmo-labs/kabmo-fs-child-env',
  },
  {
    dir: 'packages/kabmo-fs-canonical',
    name: '@kabmo-labs/kabmo-fs-canonical',
  },
  {
    dir: 'packages/kabmo-process-kill',
    name: '@kabmo-labs/kabmo-process-kill',
  },
  {
    dir: 'packages/kabmo-rpc-lines',
    name: '@kabmo-labs/kabmo-rpc-lines',
  },
  {
    dir: 'packages/kabmo-acp-stdio',
    name: '@kabmo-labs/kabmo-acp-stdio',
  },
  {
    dir: 'packages/kabmo-acp-client',
    name: '@kabmo-labs/kabmo-acp-client',
  },
  {
    dir: 'packages/kabmo-omp-extensions',
    name: '@kabmo-labs/kabmo-omp-extensions',
  },
  {
    dir: 'packages/kabmo-harness-launch',
    name: '@kabmo-labs/kabmo-harness-launch',
  },
  {
    dir: 'packages/kabmo-idle-reaper',
    name: '@kabmo-labs/kabmo-idle-reaper',
  },
  {
    dir: 'packages/kabmo-paths',
    name: '@kabmo-labs/kabmo-paths',
  },
  {
    dir: 'packages/kabmo-process-probe',
    name: '@kabmo-labs/kabmo-process-probe',
  },
  {
    dir: 'packages/kabmo-runtime-flags',
    name: '@kabmo-labs/kabmo-runtime-flags',
  },
  {
    dir: 'packages/kabmo-git-env',
    name: '@kabmo-labs/kabmo-git-env',
  },
  {
    dir: 'packages/kabmo-omp-cli',
    name: '@kabmo-labs/kabmo-omp-cli',
  },
  {
    dir: 'packages/kabmo-omp-worktree',
    name: '@kabmo-labs/kabmo-omp-worktree',
  },
  {
    dir: 'packages/kabmo-omp-install',
    name: '@kabmo-labs/kabmo-omp-install',
  },
  {
    dir: 'packages/kabmo-settings-contracts',
    name: '@kabmo-labs/kabmo-settings-contracts',
  },
  {
    dir: 'packages/kabmo-provider-contracts',
    name: '@kabmo-labs/kabmo-provider-contracts',
  },
  {
    dir: 'packages/kabmo-mcp-contracts',
    name: '@kabmo-labs/kabmo-mcp-contracts',
  },
  {
    dir: 'packages/kabmo-db',
    name: '@kabmo-labs/kabmo-db',
  },
  {
    dir: 'packages/kabmo-settings-store',
    name: '@kabmo-labs/kabmo-settings-store',
  },
  {
    dir: 'packages/kabmo-omp-subagent',
    name: '@kabmo-labs/kabmo-omp-subagent',
  },
  {
    dir: 'packages/kabmo-omp-rpc-util',
    name: '@kabmo-labs/kabmo-omp-rpc-util',
  },
  {
    dir: 'packages/kabmo-refresh-cadence',
    name: '@kabmo-labs/kabmo-refresh-cadence',
  },
  {
    dir: 'packages/kabmo-omp-subagent-presence',
    name: '@kabmo-labs/kabmo-omp-subagent-presence',
  },
  {
    dir: 'packages/kabmo-omp-session-changes',
    name: '@kabmo-labs/kabmo-omp-session-changes',
  },
  {
    dir: 'packages/kabmo-omp-session-locator',
    name: '@kabmo-labs/kabmo-omp-session-locator',
  },
  {
    dir: 'packages/kabmo-omp-session-reader',
    name: '@kabmo-labs/kabmo-omp-session-reader',
  },
  {
    dir: 'packages/kabmo-harness-account-store',
    name: '@kabmo-labs/kabmo-harness-account-store',
  },
  {
    dir: 'packages/kabmo-harness-config-store',
    name: '@kabmo-labs/kabmo-harness-config-store',
  },
  {
    dir: 'packages/kabmo-harness-local-transcript',
    name: '@kabmo-labs/kabmo-harness-local-transcript',
  },
  {
    dir: 'packages/kabmo-harness-session',
    name: '@kabmo-labs/kabmo-harness-session',
  },
  {
    dir: 'packages/kabmo-omp-mode-request',
    name: '@kabmo-labs/kabmo-omp-mode-request',
  },
  {
    dir: 'packages/kabmo-omp-rpc-commands',
    name: '@kabmo-labs/kabmo-omp-rpc-commands',
  },
  {
    dir: 'packages/kabmo-omp-rpc-events',
    name: '@kabmo-labs/kabmo-omp-rpc-events',
  },
  {
    dir: 'packages/kabmo-omp-rpc-process',
    name: '@kabmo-labs/kabmo-omp-rpc-process',
  },
  {
    dir: 'packages/kabmo-omp-rpc-protocol',
    name: '@kabmo-labs/kabmo-omp-rpc-protocol',
  },
  {
    dir: 'packages/kabmo-realtime-signals',
    name: '@kabmo-labs/kabmo-realtime-signals',
  },
  {
    dir: 'packages/kabmo-session-deleted',
    name: '@kabmo-labs/kabmo-session-deleted',
  },
  {
    dir: 'packages/kabmo-session-lifecycle',
    name: '@kabmo-labs/kabmo-session-lifecycle',
  },
  {
    dir: 'packages/kabmo-session-relations',
    name: '@kabmo-labs/kabmo-session-relations',
  },
  {
    dir: 'packages/kabmo-session-stream-state',
    name: '@kabmo-labs/kabmo-session-stream-state',
  },
  {
    dir: 'packages/kabmo-worktree-topology',
    name: '@kabmo-labs/kabmo-worktree-topology',
  },
  {
    dir: 'packages/kabmo-worktree-types',
    name: '@kabmo-labs/kabmo-worktree-types',
  },
  {
    dir: 'packages/kabmo-workspace-sidebar',
    name: '@kabmo-labs/kabmo-workspace-sidebar',
  },
  {
    dir: 'packages/kabmo-workspace-root',
    name: '@kabmo-labs/kabmo-workspace-root',
  },
  {
    dir: 'packages/kabmo-http',
    name: '@kabmo-labs/kabmo-http',
  },
  {
    /** Directory under `packages/`, which is also the tag's prefix. */
    dir: 'packages/kabmo-guards',
    name: '@kabmo-labs/kabmo-guards',
  },
  {
    dir: 'packages/kabmo-bytes',
    name: '@kabmo-labs/kabmo-bytes',
  },
  {
    dir: 'packages/kabmo-platform',
    name: '@kabmo-labs/kabmo-platform',
  },
  {
    dir: 'packages/kabmo-fs-config',
    name: '@kabmo-labs/kabmo-fs-config',
  },
  {
    dir: 'packages/kabmo-fs-media',
    name: '@kabmo-labs/kabmo-fs-media',
  },
  {
    dir: 'packages/kabmo-model-contracts',
    name: '@kabmo-labs/kabmo-model-contracts',
  },
  {
    dir: 'packages/kabmo-format',
    name: '@kabmo-labs/kabmo-format',
  },
  {
    dir: 'packages/kabmo-harness-catalog',
    name: '@kabmo-labs/kabmo-harness-catalog',
  },
  {
    dir: 'packages/kabmo-harness-contract',
    name: '@kabmo-labs/kabmo-harness-contract',
  },
  {
    dir: 'packages/kabmo-harness-registry',
    name: '@kabmo-labs/kabmo-harness-registry',
  },
  {
    dir: 'packages/kabmo-harness-accounts',
    name: '@kabmo-labs/kabmo-harness-accounts',
  },
  {
    dir: 'packages/kabmo-harness-session-modes',
    name: '@kabmo-labs/kabmo-harness-session-modes',
  },
  {
    dir: 'packages/kabmo-harness-transcript',
    name: '@kabmo-labs/kabmo-harness-transcript',
  },
  {
    dir: 'packages/kabmo-harness-provider-runtime',
    name: '@kabmo-labs/kabmo-harness-provider-runtime',
  },
  {
    dir: 'packages/kabmo-harness-update-job',
    name: '@kabmo-labs/kabmo-harness-update-job',
  },
  {
    dir: 'packages/kabmo-harness-lease',
    name: '@kabmo-labs/kabmo-harness-lease',
  },
  {
    dir: 'packages/kabmo-harness-provider-slug',
    name: '@kabmo-labs/kabmo-harness-provider-slug',
  },
  {
    dir: 'packages/kabmo-omp-paths',
    name: '@kabmo-labs/kabmo-omp-paths',
  },
  {
    dir: 'packages/kabmo-omp-contracts',
    name: '@kabmo-labs/kabmo-omp-contracts',
  },
  {
    dir: 'packages/kabmo-omp-registry',
    name: '@kabmo-labs/kabmo-omp-registry',
  },
  {
    dir: 'packages/kabmo-omp-proc',
    name: '@kabmo-labs/kabmo-omp-proc',
  },
  {
    dir: 'packages/kabmo-omp-mode',
    name: '@kabmo-labs/kabmo-omp-mode',
  },
  {
    dir: 'packages/kabmo-omp-schema',
    name: '@kabmo-labs/kabmo-omp-schema',
  },
  {
    dir: 'packages/kabmo-omp-session-core',
    name: '@kabmo-labs/kabmo-omp-session-core',
  },
  {
    dir: 'packages/kabmo-omp-models-config',
    name: '@kabmo-labs/kabmo-omp-models-config',
  },
  {
    dir: 'packages/kabmo-omp-operator-title',
    name: '@kabmo-labs/kabmo-omp-operator-title',
  },
  {
    dir: 'packages/kabmo-omp-session-sidebar',
    name: '@kabmo-labs/kabmo-omp-session-sidebar',
  },
  {
    dir: 'packages/kabmo-omp-session-telemetry',
    name: '@kabmo-labs/kabmo-omp-session-telemetry',
  },
  {
    dir: 'packages/kabmo-omp-session-runtime',
    name: '@kabmo-labs/kabmo-omp-session-runtime',
  },
  {
    dir: 'packages/kabmo-omp-session-scan',
    name: '@kabmo-labs/kabmo-omp-session-scan',
  },
  {
    dir: 'packages/kabmo-omp-access-mode',
    name: '@kabmo-labs/kabmo-omp-access-mode',
  },
  {
    dir: 'packages/kabmo-omp-config-files',
    name: '@kabmo-labs/kabmo-omp-config-files',
  },
  {
    dir: 'packages/kabmo-omp-config-providers',
    name: '@kabmo-labs/kabmo-omp-config-providers',
  },
  {
    dir: 'packages/kabmo-omp-config-mcp',
    name: '@kabmo-labs/kabmo-omp-config-mcp',
  },
  {
    dir: 'packages/kabmo-omp-config-doc',
    name: '@kabmo-labs/kabmo-omp-config-doc',
  },
  {
    dir: 'packages/kabmo-chat-contracts',
    name: '@kabmo-labs/kabmo-chat-contracts',
  },
  {
    dir: 'packages/kabmo-chat-tool',
    name: '@kabmo-labs/kabmo-chat-tool',
  },
  {
    dir: 'packages/kabmo-chat-notices',
    name: '@kabmo-labs/kabmo-chat-notices',
  },
  {
    dir: 'packages/kabmo-omp-session-parse',
    name: '@kabmo-labs/kabmo-omp-session-parse',
  },
  {
    dir: 'packages/kabmo-acp-turn',
    name: '@kabmo-labs/kabmo-acp-turn',
  },
  {
    dir: 'packages/kabmo-acp-prompt',
    name: '@kabmo-labs/kabmo-acp-prompt',
  },
  {
    dir: 'packages/kabmo-acp-session',
    name: '@kabmo-labs/kabmo-acp-session',
  },
  {
    dir: 'packages/kabmo-acp-control',
    name: '@kabmo-labs/kabmo-acp-control',
  },
  {
    dir: 'packages/kabmo-acp-session-core',
    name: '@kabmo-labs/kabmo-acp-session-core',
  },
  {
    dir: 'packages/kabmo-acp-session-config',
    name: '@kabmo-labs/kabmo-acp-session-config',
  },
  {
    dir: 'packages/kabmo-omp-mapper',
    name: '@kabmo-labs/kabmo-omp-mapper',
  },
  {
    dir: 'packages/kabmo-omp-messages-map',
    name: '@kabmo-labs/kabmo-omp-messages-map',
  },
  {
    dir: 'packages/kabmo-omp-session-messages',
    name: '@kabmo-labs/kabmo-omp-session-messages',
  },
  {
    dir: 'packages/kabmo-harness-provider',
    name: '@kabmo-labs/kabmo-harness-provider',
  },
  {
    dir: 'packages/kabmo-harness-config',
    name: '@kabmo-labs/kabmo-harness-config',
  },
  {
    dir: 'packages/kabmo-harness-enabled',
    name: '@kabmo-labs/kabmo-harness-enabled',
  },
  {
    dir: 'packages/kabmo-harness-updates',
    name: '@kabmo-labs/kabmo-harness-updates',
  },
  {
    dir: 'packages/kabmo-harness-config-fields',
    name: '@kabmo-labs/kabmo-harness-config-fields',
  },
  {
    dir: 'packages/kabmo-harness-mcp-facts',
    name: '@kabmo-labs/kabmo-harness-mcp-facts',
  },
  {
    dir: 'packages/kabmo-harness-schema',
    name: '@kabmo-labs/kabmo-harness-schema',
  },
  {
    dir: 'packages/kabmo-harness-rewind',
    name: '@kabmo-labs/kabmo-harness-rewind',
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
