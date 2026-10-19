/**
 * Reading the commit range a package release is decided from.
 *
 * semantic-release hands each plugin the commits it collected, but nothing in
 * that list says which FILES a commit touched — `git-log-parser` reads a fixed
 * field set (hash, author, committer, subject, body) and no path. A package
 * release needs the paths, because the rule that keeps an app commit from
 * bumping the SDK's version is "did this commit touch the SDK's directory".
 *
 * Two `git` calls, both whole-range rather than per commit:
 *
 * 1. `git log` once for the range, with a record separator no commit message
 *    contains. The subject/body fields come from git itself rather than from a
 *    second parser, and `author`/`committer` are both set to the author: the
 *    credit clause reads the author, and the committer of a rebase is not who
 *    wrote the change.
 * 2. `git diff-tree --stdin` once for every hash, which prints one hash line
 *    followed by the paths that commit changed. Measured against `git log
 *    --name-only` on the same range: identical paths, and `--stdin` accepts all
 *    hashes in a single process instead of one `git log` per commit.
 *
 * `--root` is what makes the repository's first commit list its paths at all —
 * without it git treats it as having no parent to diff against and prints
 * nothing, so a package created in that commit would look untouched.
 */

import { spawnSync } from 'node:child_process';

/** Field separator inside one record; a commit message cannot contain it. */
const FIELD = '\x1f';

/** Record separator between commits. */
const RECORD = '\x1e';

/**
 * Run `git` and return its stdout, or throw with git's own stderr.
 *
 * @param {string[]} args
 * @param {string} cwd
 * @param {string} [input] Written to stdin when given.
 * @returns {string}
 */
function git(args, cwd, input) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    input,
    // A long history of full messages is still far below this; the default 1 MB
    // would truncate silently and drop commits from the analysis.
    maxBuffer: 256 * 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed:\n${result.stderr}`);
  }

  return result.stdout;
}

/**
 * The commits in a range, newest first.
 *
 * @param {string} range `git log` range, e.g. `kabmo-sdk/v1.0.0..HEAD`.
 * @param {string} cwd
 * @returns {Array<{hash: string, message: string, author: {name: string, email: string}, committer: {name: string, email: string}}>}
 */
export function collectCommits(range, cwd) {
  const stdout = git(['log', `--format=${RECORD}%H${FIELD}%an${FIELD}%ae${FIELD}%B${RECORD}`, range], cwd);

  return stdout
    .split(RECORD)
    .map((chunk) => chunk.replace(/^\n+/, ''))
    .filter((chunk) => chunk.trim() !== '')
    .map((chunk) => {
      const [hash, name, email, ...body] = chunk.split(FIELD);
      const identity = { name, email };

      return {
        hash,
        message: body.join(FIELD).replace(/\n+$/, ''),
        author: identity,
        committer: identity,
      };
    });
}

/**
 * Which paths each commit changed, keyed by hash.
 *
 * A hash whose commit changed nothing (a merge, an empty commit) maps to an
 * empty array rather than being absent, so a caller can tell "no paths" from
 * "not asked about".
 *
 * @param {string[]} hashes
 * @param {string} cwd
 * @returns {Map<string, string[]>}
 */
export function filesForCommits(hashes, cwd) {
  /** @type {Map<string, string[]>} */
  const byHash = new Map(hashes.map((hash) => [hash, []]));

  if (hashes.length === 0) {
    return byHash;
  }

  const stdout = git(
    ['diff-tree', '--stdin', '--name-only', '-r', '--root'],
    cwd,
    `${hashes.join('\n')}\n`,
  );

  let current = null;

  for (const line of stdout.split('\n')) {
    if (line === '') {
      continue;
    }

    // A hash line is what starts the next commit's block; every other non-empty
    // line is a path belonging to the block already open. `diff-tree --stdin`
    // echoes the hash it is answering for, which is what makes one pass
    // parseable — and `--name-only` guarantees a path can never look like one.
    if (byHash.has(line)) {
      current = line;
    } else if (current !== null) {
      byHash.get(current).push(line);
    }
  }

  return byHash;
}
