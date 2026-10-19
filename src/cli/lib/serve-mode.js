/**
 * Serve-mode selection for `kabmo serve`.
 *
 * The CLI always runs the production build: it is what a user of the command
 * wants (no HMR client, no unminified dev bundle re-downloaded per page load),
 * and `bun run dev` remains the source-checkout dev loop with `--hot`.
 *
 * `--dev` is the escape hatch that keeps the source entry servable through the
 * CLI — a build is required to serve production, so a checkout that cannot
 * build still has a way to start.
 *
 * Kept apart from `commands/serve.js` for the reason `restart-scope.js` and
 * `stop-scope.js` are: the rule is testable without importing the server
 * modules the command needs.
 */

/** `'prod'` unless `--dev` was passed. */
export function resolveServeMode(options) {
  return options?.dev === true ? 'dev' : 'prod';
}
