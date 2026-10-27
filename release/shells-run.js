/**
 * The grouped shell bump, with its collaborators passed in.
 *
 * `release/release-shells.mjs` is the CLI around this: argv, the GitHub output
 * file, the console and the exit status. The DECISIONS live here so they can be
 * driven without a real commit history — the alternative is a test that builds a
 * throwaway repository and copies the release scripts into it, which is the same
 * rule tested through four moving parts instead of one.
 *
 * Two invariants are the reason this is a module rather than a loop in the
 * script, and both are asserted:
 *
 * 1. **One pass, one commit.** Every selected shell is planned before the first
 *    byte is written, and the caller commits the set as a single `chore`.
 * 2. **All or nothing.** A shell that cannot be read, analysed or rewritten
 *    fails the whole run BEFORE any other version file is touched. The
 *    sequential jobs this replaced could land a bump for `android` and then fail
 *    on `ios`, leaving `main` describing a release that half happened.
 */

/**
 * Decide one shell's next version, without writing it.
 *
 * @param {object} shell A catalog entry (`release/shells.js`).
 * @param {string} root Repository root.
 * @param {(commits: Array<{hash: string, message: string}>, cwd: string) => Promise<string|null>} analyze
 *   The commit analyser, injected (`@semantic-release/commit-analyzer` in the
 *   script) so a test can answer without a history.
 * @param {(version: string, type: string) => string} bump
 * @param {(path: string) => string} read
 * @returns {Promise<object>} One outcome, tagged by `status`.
 */
export async function planShell({ shell, root, analyze, bump, read }) {
  try {
    const source = read(`${root}/${shell.versionFile}`);
    const current = shell.readVersionName(source);

    if (!current) {
      return { shell, status: 'failed', reason: `${shell.versionFile} declares no ${shell.key}` };
    }

    const commits = shell.commitsSinceWatermark(root);

    if (commits.length === 0) {
      return { shell, status: 'unchanged', from: current };
    }

    // A range of `chore`/`docs`/`test` commits asks for no version at all. That
    // is a real answer: a change to a shell's own tests has nothing for an
    // installed app to receive, so bumping would ship a no-op update.
    const type = await analyze(commits, root);

    if (!type) {
      return { shell, status: 'no-bump', from: current, commits: commits.length };
    }

    return {
      shell,
      status: 'bumped',
      from: current,
      next: bump(current, type),
      type,
      commits: commits.length,
      source,
    };
  } catch (error) {
    return { shell, status: 'failed', reason: error.message };
  }
}

/**
 * Bump every selected shell, or none of them.
 *
 * @param {object} deps
 * @param {Array<object>} deps.shells The catalog entries to bump.
 * @param {string} deps.root Repository root.
 * @param {(commits: object[], cwd: string) => Promise<string|null>} deps.analyze
 * @param {(version: string, type: string) => string} deps.bump
 * @param {(path: string) => string} deps.read
 * @param {(path: string, text: string) => void} deps.write
 * @param {boolean} [deps.dryRun] Plan everything, write nothing.
 * @returns {Promise<{outcomes: object[], failed: boolean, written: object[]}>}
 *   `written` is empty on a failed or dry run — the caller's commit step reads
 *   `outcomes`, so this is what a caller inspecting the tree should trust.
 */
export async function runShellBumps({ shells, root, analyze, bump, read, write, dryRun = false }) {
  const outcomes = [];

  for (const shell of shells) {
    outcomes.push(await planShell({ shell, root, analyze, bump, read }));
  }

  const hasFailure = (list) => list.some((outcome) => outcome.status === 'failed');

  // Every decision is in before the first write: a descriptor that cannot be
  // read or analysed leaves the tree untouched, so a caller can never commit a
  // partial bump.
  if (hasFailure(outcomes)) {
    return { outcomes, failed: true, written: [] };
  }

  const written = [];

  if (!dryRun) {
    for (const outcome of outcomes) {
      if (outcome.status !== 'bumped') continue;

      try {
        const { shell } = outcome;
        write(`${root}/${shell.versionFile}`, shell.replaceVersionLine(outcome.source, outcome.from, outcome.next));
        written.push(outcome);
      } catch (error) {
        outcome.status = 'failed';
        outcome.reason = error.message;
      }
    }
  }

  return { outcomes, failed: hasFailure(outcomes), written };
}
