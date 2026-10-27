/**
 * The ONE commit every released package shares, and the tags that point at it.
 *
 * `@semantic-release/git` used to commit each package on its own — its `prepare`
 * step adds the assets, commits, and PUSHES — so a run where both
 * `@kabmo-labs/kabmo-sdk` and `@kabmo-labs/kabmo-ui` released left two commits
 * and two pushes, and semantic-release's core tagged each one at the moment that
 * package finished. The grouping is the same idea the shells got: the commit is
 * a bookkeeping artefact, not a release unit, and two of them describe one
 * release run.
 *
 * Semantic-release still decides everything that matters — the version, the
 * changelog and the notes — with the git side effects removed from its config
 * (see `packageReleaseConfig`). It runs with `dryRun: true`, which is what makes
 * core skip ITS tag/release step while the write plugins still run, so the
 * working tree is fully written when this module is called.
 *
 * Three rules follow from doing that here rather than per package, and each is
 * a way a hand-rolled release goes wrong:
 *
 * 1. **Every asset is staged in ONE `git add` and committed ONCE.** Two commits
 *    would be the shape this replaces, and `git commit -a` would sweep an
 *    unrelated change into a `chore` that claims to be a version bump.
 * 2. **Both tags are created at that commit, and the branch and tags are pushed
 *    in one ATOMIC push.** A tag pushed while its commit was rejected points at
 *    a release nobody can find; `--atomic` makes the remote take all of it or
 *    none. The tags are LIGHTWEIGHT, which is what semantic-release creates
 *    (`git tag <name> <ref>`), and a tag with no note is read by
 *    `getLastRelease` as the release channel — no note is needed.
 * 3. **Nothing is written when nothing released.** An empty set must not create
 *    an empty commit, and the caller reads the returned set, not the tree.
 */

import { existsSync } from 'node:fs';

/**
 * The tag of every released package, in catalog order.
 *
 * @param {Array<{tag: string}>} released
 * @returns {string[]}
 */
export function releaseTags(released) {
  return released.map((release) => release.tag);
}

/**
 * The files the one commit carries.
 *
 * `bun.lock` is shared: the version plugin refreshes it, and `bun publish`
 * substitutes a `workspace:` spec from the version the LOCK records rather than
 * from the manifest — so leaving it out re-publishes the stale pin.
 *
 * @param {Array<{entry: {dir: string}}>} released
 * @returns {string[]}
 */
export function releaseAssets(released) {
  const assets = [];

  for (const { entry } of released) {
    assets.push(`${entry.dir}/CHANGELOG.md`, `${entry.dir}/package.json`);
  }

  assets.push('bun.lock');

  return assets;
}
/**
 * The commit's subject.
 *
 * It names every tag rather than a single version, because the commit is the
 * release note for the SET: `chore(release): kabmo-sdk/v0.1.1, kabmo-ui/v0.2.1`.
 * `[skip ci]` because the gates already ran on the push that produced it, and
 * because a push made with `GITHUB_TOKEN` raises no workflow run anyway.
 *
 * @param {Array<{tag: string}>} released
 * @returns {string}
 */
export function releaseCommitMessage(released) {
  return `chore(release): ${releaseTags(released).join(', ')} [skip ci]`;
}

/**
 * Stage the assets, commit them once, tag each release at that commit, and push
 * the branch with its tags atomically.
 *
 * An asset that does not exist is SKIPPED rather than staged: the changelog
 * plugin writes nothing when the notes are empty, and `git add` on a missing
 * path is a fatal error that would sink the whole release for a file nobody was
 * going to read. That is also what `@semantic-release/git` did — it diffed the
 * working tree and matched only the paths that changed.
 *
 * @param {object} deps
 * @param {Array<{entry: {dir: string}, tag: string}>} deps.released
 * @param {(args: string[]) => void} deps.git Runs one `git` command; throws on failure.
 * @param {(path: string) => boolean} [deps.exists] Injected so a test can drive a
 *   tree without one; defaults to `fs.existsSync`.
 * @returns {{message: string, tags: string[], assets: string[]}|null} What it did,
 *   or null when there was nothing to release.
 */
export function commitRelease({ released, git, exists = existsSync }) {
  if (released.length === 0) return null;

  const assets = releaseAssets(released).filter((asset) => exists(asset));
  const tags = releaseTags(released);
  const message = releaseCommitMessage(released);

  git(['add', ...assets]);
  git(['commit', '-q', '-m', message]);

  for (const tag of tags) {
    git(['tag', tag, 'HEAD']);
  }

  // One push, all of it or none: `--atomic` is what keeps a rejected tag from
  // leaving the branch moved without the release it describes.
  git(['push', '--atomic', 'origin', 'HEAD:main', ...tags]);

  return { message, tags, assets };
}

/**
 * Create the GitHub release for each tag, with the notes semantic-release
 * generated.
 *
 * `@semantic-release/github` used to do this per package; with the git work
 * grouped, the release pages are the only per-package side effect left, and
 * they are a plain REST call. A `422 already_exists` is treated as success: a
 * re-run after a partially failed job must not fail on the release it already
 * created.
 *
 * @param {object} deps
 * @param {Array<{tag: string, notes?: string, version: string}>} deps.released
 * @param {string|undefined} deps.token `GITHUB_TOKEN`/`GH_TOKEN`.
 * @param {string|undefined} deps.repository `owner/repo`, from the workflow.
 * @param {typeof fetch} deps.fetchImpl
 * @returns {Promise<string[]>} The tags whose release page was ensured.
 */
export async function createGithubReleases({ released, token, repository, fetchImpl }) {
  if (released.length === 0) return [];

  if (!token) {
    throw new Error('no GITHUB_TOKEN/GH_TOKEN: cannot create the package release pages');
  }
  if (!repository) {
    throw new Error('no GITHUB_REPOSITORY: cannot tell which repository to release into');
  }

  const created = [];

  for (const release of released) {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}/releases`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify({
        tag_name: release.tag,
        name: release.tag,
        body: release.notes ?? '',
      }),
    });

    if (!response.ok) {
      const text = await response.text();

      // A tag that already carries its release is the state this call exists to
      // reach, not a failure — a re-run must be able to finish the job.
      if (response.status === 422 && text.includes('already_exists')) {
        created.push(release.tag);
        continue;
      }

      throw new Error(`GitHub release ${release.tag} failed: ${response.status} ${text}`);
    }

    created.push(release.tag);
  }

  return created;
}
