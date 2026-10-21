/**
 * The version bump, asserted.
 *
 * Every expectation below is the outcome `release.config.mjs` produces today,
 * measured by running the real `@semantic-release/commit-analyzer` and
 * `release-notes-generator` against the config — not a restatement of what
 * `release/release-rules.js` reads like. The cases that matter most are the two
 * that were wrong before the rules module existed: a `!` on a type that cannot
 * carry a breaking change (which used to release a major version), and prose in
 * a body that merely mentions a breaking change (which cut v1.0.0 out of a
 * range of `feat`s and printed the prose as the changelog's breaking note).
 */
import { expect, test } from 'bun:test';
import { analyzeCommits } from '@semantic-release/commit-analyzer';
import { fileURLToPath } from 'node:url';
import config from '../release.config.mjs';

const cwd = fileURLToPath(new URL('..', import.meta.url));

/** The analyzer exactly as `release.config.mjs` hands it to semantic-release. */
const analyzerConfig = config.plugins.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === '@semantic-release/commit-analyzer',
)[1];

/** A commit shaped like the ones semantic-release collects from `git log`. */
const commit = (message) => ({
  hash: 'a'.repeat(40),
  message,
  subject: message.split('\n')[0],
  notes: [],
  type: null,
  scope: null,
  header: '',
  body: '',
  footer: '',
  revert: null,
  author: { name: 'Author', email: '1+octocat@users.noreply.github.com' },
  committer: { name: 'Author', email: '1+octocat@users.noreply.github.com' },
});

const bump = (message) =>
  analyzeCommits(analyzerConfig, {
    commits: [commit(message)],
    cwd,
    options: {},
    logger: { log() {} },
  });

test('a breaking change releases major on the types that can carry one', async () => {
  expect(await bump('feat!: drop the legacy endpoint')).toBe('major');
  expect(await bump('feat(build)!: bundle the client with Bun instead of rsbuild')).toBe('major');
  expect(await bump('fix!: rename the host variable')).toBe('major');
  expect(await bump('perf!: change the frame shape')).toBe('major');
  expect(await bump('refactor!: move the provider modules')).toBe('major');
  expect(await bump('feature!: an alias that carries one too')).toBe('major');
});

test('a breaking-change footer releases major', async () => {
  expect(await bump('feat: rename the host variable\n\nBREAKING CHANGE: `OMP_WEB_OMP_BIN` is now `KABMO_OMP_BIN`')).toBe('major');
  expect(await bump('fix: rename it\n\nBREAKING-CHANGE: the old name is no longer read')).toBe('major');
  expect(await bump('feat: it\n\n* BREAKING CHANGE: still a footer')).toBe('major');
});

test('a `!` on a type that cannot carry a breaking change releases nothing', async () => {
  // The analyzer's built-in `{ breaking: true, release: "major" }` fallback used
  // to decide these, so a chore or a docs commit could cut a major version.
  expect(await bump('chore!: reorder the ignore file')).toBeNull();
  expect(await bump('docs!: rewrite the architecture notes')).toBeNull();
  expect(await bump('style!: reformat the components')).toBeNull();
  expect(await bump('test!: split the queue suite')).toBeNull();
  expect(await bump('build!: bump the bundler')).toBeNull();
  expect(await bump('ci!: restructure the workflows')).toBeNull();
  expect(await bump('chore: x\n\nBREAKING CHANGE: a footer on a chore')).toBeNull();
});

test('prose that mentions a breaking change is not a breaking change', async () => {
  // The parser's own note regex is case-insensitive, so any line starting with
  // `breaking change` / `breaking-change` — colon optional — counted. This is
  // the commit that cut v1.0.0: a docs commit whose body wraps onto the phrase.
  const prose = [
    'docs: add conventional commit type selection rules to AGENTS.md',
    '',
    'define each commit type by observable behavior change, mark the types',
    'hidden from the changelog per release.config.mjs, and document the',
    'breaking-change (!) footer plus the mixed-change split rule. The',
    'commit subject doubles as a changelog bullet.',
  ].join('\n');

  expect(await bump(prose)).toBeNull();
  expect(await bump('feat: x\n\nbreaking-change: lowercased prose')).toBe('minor');
  expect(await bump('feat: x\n\nBreaking Change: title-cased prose')).toBe('minor');
  expect(await bump('feat: x\n\nbreaking-change in the API, no colon')).toBe('minor');
});

test('the ordinary types keep their level', async () => {
  expect(await bump('feat: add a view')).toBe('minor');
  expect(await bump('feature: an alias for feat')).toBe('minor');
  expect(await bump('fix: stop the spinner')).toBe('patch');
  expect(await bump('perf: scan with indexOf')).toBe('patch');
  expect(await bump('revert: feat: add a view\n\nThis reverts commit ' + 'b'.repeat(40) + '.')).toBe('patch');
  expect(await bump('revert: undo the view without a body')).toBe('patch');
});

test('the types that never release a version', async () => {
  expect(await bump('docs: describe the dev loop')).toBeNull();
  expect(await bump('refactor: group the modules')).toBeNull();
  expect(await bump('chore: reorder the ignore file')).toBeNull();
  expect(await bump('style: reformat')).toBeNull();
  expect(await bump('test: cover the snapshot')).toBeNull();
  expect(await bump('build: move the bundler')).toBeNull();
  expect(await bump('ci: pin the runner')).toBeNull();
  expect(await bump('chore(release): v3.0.0 [skip ci]')).toBeNull();
  expect(await bump('Merge pull request #4 from rajebdev/docs/env-example-real-vars')).toBeNull();
});

test('a release commit and a merge commit carry no version of their own', async () => {
  // The bot's own release commit is a chore, so it can never re-trigger a bump;
  // a merge commit has no type at all.
  expect(await bump('chore(release): v2.0.2 [skip ci]')).toBeNull();
  expect(await bump('Merge branch main')).toBeNull();
});
