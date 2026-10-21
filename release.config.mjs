/**
 * semantic-release configuration — driven by `.github/workflows/release.yml` on
 * every push to `main`.
 *
 * The pipeline keeps the two promises `CHANGELOG.md` already made by hand: the
 * version comes from Conventional Commits, and each released section keeps its
 * shape — `## [x.y.z] — YYYY-MM-DD` over the Added / Changed / Fixed / Removed
 * categories, newest first, under an untouched intro block. Which type moves
 * the version is not decided here: `release/release-rules.js` holds that
 * contract, including the two places where the toolchain's own defaults would
 * release something this repository does not mean.
 *
 * A bullet credits the contributor who wrote it, unless that contributor is the
 * repository owner: `release/contributors.js` reads GitHub's privacy addresses
 * (`NNN+login@users.noreply.github.com`) directly and asks the API about every
 * other author — the job's `GITHUB_TOKEN` is what makes that second path work,
 * so a rehearsal without one credits privacy addresses alone.
 *
 * Two pins here are load-bearing:
 *
 * - `conventional-changelog-conventionalcommits@9` is the last preset written for
 *   `conventional-changelog-writer@8`, which is what
 *   `@semantic-release/release-notes-generator@14` (the one semantic-release 25
 *   installs) resolves. Preset 10 targets writer 9, and against writer 8 it
 *   renders its own "requires writer@9" guard message instead of release notes.
 * - `@semantic-release/npm` writes the release version into `package.json` via
 *   `npm version`, so the job running this config needs Node and its npm on PATH
 *   (`actions/setup-node`) — Bun alone is not enough. Publishing stays out of
 *   this pipeline: `npmPublish: false` and `.github/workflows/publish.yml` owns
 *   the npm side.
 *
 * Rehearsing a release locally is not just `--dry-run`: see the note at the top of
 * `.github/workflows/release.yml`, which is where the isolated recipe lives — and
 * where the reason `origin` alone does not contain it is written down.
 */
import { readFileSync } from 'node:fs';
import conventionalcommits from 'conventional-changelog-conventionalcommits';
import { attachThanks, withThanksClause } from './release/contributors.js';
import { parserOpts, releaseRules } from './release/release-rules.js';

const changelog = 'CHANGELOG.md';

/**
 * Everything above the newest `## [x.y.z]` heading: the `# Changelog` title and
 * the format paragraph. `@semantic-release/changelog` can only prepend the new
 * section above the *whole* file, so the intro is handed back to it as
 * `changelogTitle`, the one option it re-emits verbatim ahead of the notes.
 * Reading it from the file keeps that block in a single place.
 */
const changelogIntro = (() => {
  const markdown = readFileSync(new URL(changelog, import.meta.url), 'utf8');
  const firstSection = markdown.indexOf('\n## ');

  return (firstSection === -1 ? markdown : markdown.slice(0, firstSection)).trim();
})();

/**
 * `commitGroupsSort` ranks sections by their first appearance in this list, so
 * the order below is the changelog's order. A hidden type is hidden from the
 * section list; what decides whether a commit releases anything is
 * `releaseRules` in `release/release-rules.js`, where every type this
 * repository uses carries `release: false` — a push of chores, docs, CI or
 * tests alone cuts no version, with or without a `!` on the type.
 */
const commitTypes = [
  { type: 'feat', section: 'Added' },
  { type: 'feature', section: 'Added' },
  { type: 'perf', section: 'Changed' },
  { type: 'refactor', section: 'Changed' },
  { type: 'docs', section: 'Changed' },
  { type: 'fix', section: 'Fixed' },
  { type: 'revert', section: 'Removed' },
  { type: 'chore', section: 'Miscellaneous Chores', hidden: true },
  { type: 'style', section: 'Styles', hidden: true },
  { type: 'test', section: 'Tests', hidden: true },
  { type: 'build', section: 'Build System', hidden: true },
  { type: 'ci', section: 'Continuous Integration', hidden: true },
];

/**
 * The preset's own commit partial, loaded rather than copied so the scope
 * prefix, the hash link and the `, closes` list stay exactly what the pinned
 * preset renders — only the credit clause is added, at the seam the preset
 * marks for it (see `release/contributors.js`).
 */
const { commitPartial: presetCommitPartial } = (await conventionalcommits({ types: commitTypes })).writer;

const commitPartial = withThanksClause(presetCommitPartial);

/**
 * The house header links the version to its compare range. It does so with a
 * reference (`[0.6.0]` plus a `[0.6.0]:` definition at the file's tail, which the
 * writer cannot maintain); the inline form below renders identically.
 */
const headerPartial = `## {{#if linkCompare}}[{{version}}]({{host}}/{{owner}}/{{repository}}/compare/{{previousTag}}...{{currentTag}}){{else}}[{{version}}]{{/if}} — {{date}}
`;

/**
 * The preset's own main template with the `⚠` dropped from the BREAKING CHANGES
 * heading — emoji are not part of this changelog's voice. Note groups lead,
 * because a breaking change outranks whatever section it arrived in.
 */
const mainTemplate = `{{> header}}
{{#if noteGroups}}
{{#each noteGroups}}

### {{title}}

{{#each notes}}
* {{#if commit.scope}}**{{commit.scope}}:** {{/if}}{{text}}
{{/each}}
{{/each}}
{{/if}}
{{#each commitGroups}}

{{#if title}}
### {{title}}

{{/if}}
{{#each commits}}
{{> commit root=@root}}
{{/each}}
{{/each}}
{{> footer}}
`;

/**
 * Attribution is the notes generator's job to display and ours to fill in: the
 * writer runs `finalizeContext` on the commits it is about to render, which is
 * the last point where each one still carries both its hash and its author.
 * Those objects are the ones the template reads, so setting `thanks` there is
 * what the credit clause renders.
 */
const finalizeContext = async (context, _options, commits) => {
  const credited = await attachThanks(commits, {
    owner: context.owner,
    host: context.host,
    repository: context.repository,
    api: process.env.GITHUB_API_URL ?? 'https://api.github.com',
    token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN,
  });

  if (credited) {
    console.log(`changelog: credited ${credited} commit(s) to their authors`);
  }

  return context;
};

export default {
  branches: ['main'],
  tagFormat: 'v${version}',
  plugins: [
    [
      '@semantic-release/commit-analyzer',
      { preset: 'conventionalcommits', presetConfig: { types: commitTypes }, parserOpts, releaseRules },
    ],
    [
      '@semantic-release/release-notes-generator',
      { preset: 'conventionalcommits', presetConfig: { types: commitTypes }, parserOpts, writerOpts: { commitPartial, headerPartial, mainTemplate, finalizeContext } },
    ],
    ['@semantic-release/changelog', { changelogFile: changelog, changelogTitle: changelogIntro }],
    ['@semantic-release/npm', { npmPublish: false }],
    [
      '@semantic-release/git',
      {
        assets: [changelog, 'package.json'],
        message: 'chore(release): v${nextRelease.version} [skip ci]',
      },
    ],
    '@semantic-release/github',
  ],
};
