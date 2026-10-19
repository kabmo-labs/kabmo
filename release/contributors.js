/**
 * Contributor credit for the release notes the pipeline generates.
 *
 * The notes generator hands every commit a git identity — `author.name` and
 * `author.email` — and nothing else, so the handle a changelog wants (the
 * GitHub login) has to be resolved from it:
 *
 * - A `NNN+login@users.noreply.github.com` address carries the login verbatim.
 *   It covers everything committed through the web UI or with GitHub's "keep my
 *   email private" setting, and it costs no request.
 * - Every other address is a real mailbox, and only the API can say which
 *   account it belongs to: `GET /repos/{owner}/{repo}/commits/{sha}` reports the
 *   author GitHub attributed that commit to, and returns `null` when the address
 *   is not verified on any account. It needs a token, so without one the credit
 *   is simply skipped.
 *
 * Resolution is best-effort by design: a missing token, a failed request, an
 * unattributed commit or a bot leaves the bullet as it was, because a release
 * must not fail over a courtesy line. The repository owner is never credited —
 * the maintainer's own commits are the bulk of most releases, and crediting them
 * is noise the changelog does not need.
 *
 * Results are memoized per email: one author who lands ten commits costs one
 * lookup, which is also what keeps a release well inside the API rate limit.
 */

const NOREPLY_EMAIL = /^(?:\d+\+)?([A-Za-z0-9-]+(?:\[bot\])?)@users\.noreply\.github\.com$/;

/**
 * A dependency bump is not a contribution: GitHub Apps commit as
 * `49699333+dependabot[bot]@users.noreply.github.com`, and the login they carry
 * — or the one the API reports — ends in the `[bot]` suffix.
 */
const BOT_LOGIN = /\[bot\]$/i;

/**
 * Where the credit belongs in the preset's commit partial: after the commit
 * link, before the `, closes` list. The preset marks that seam with this
 * comment and grows it no other way, so a preset bump that drops the marker
 * would silently stop crediting contributors — `withThanksClause` throws there
 * instead, because a changelog that quietly loses attribution is worse than a
 * release that refuses to run.
 */
const REFERENCES_MARKER = '{{~!-- commit references --}}';

const THANKS_CLAUSE = '{{#if thanks}} (thanks {{thanks}}){{/if}}';

/**
 * Extend the preset's commit partial with the credit clause.
 *
 * @param {String} commitPartial The partial as the pinned preset renders it.
 * @returns {String} The same partial, crediting `commit.thanks` when set.
 */
export function withThanksClause(commitPartial) {
  if (!commitPartial.includes(REFERENCES_MARKER)) {
    throw new Error(
      `conventionalcommits' commit partial no longer carries ${REFERENCES_MARKER}, so the contributor credit has nowhere to go`,
    );
  }

  return commitPartial.replace(REFERENCES_MARKER, `${REFERENCES_MARKER}${THANKS_CLAUSE}`);
}

/**
 * The login a GitHub privacy address carries, or `null` for a real mailbox.
 *
 * @param {String} email
 * @returns {String|null}
 */
function loginFromEmail(email) {
  const match = NOREPLY_EMAIL.exec(email);

  return match ? match[1] : null;
}

/**
 * The login GitHub attributed a commit to, or `null` when it attributed it to
 * no account — an unverified address, a deleted account, a bot.
 *
 * @param {String} hash The commit hash the API is asked about.
 * @param {Object} request
 * @returns {Promise<String|null>}
 */
async function loginFromApi(hash, request) {
  const { api, owner, repository, token, fetchImpl } = request;

  try {
    const response = await fetchImpl(`${api}/repos/${owner}/${repository}/commits/${hash}`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'user-agent': 'kabmo-release-notes',
      },
    });

    if (!response.ok) {
      console.warn(`changelog: ${response.status} reading the author of ${hash.slice(0, 7)}`);

      return null;
    }

    const { author } = await response.json();

    // `type: 'Bot'` is what a GitHub App reports; `attachThanks` drops the
    // `[bot]` login suffix, for payloads that omit the type.
    return author?.type === 'Bot' ? null : (author?.login ?? null);
  } catch (error) {
    console.warn(`changelog: could not read the author of ${hash.slice(0, 7)}: ${error.message}`);

    return null;
  }
}

/**
 * Credit every commit whose author is not the repository owner, by setting the
 * `thanks` field the commit partial renders.
 *
 * @param {Array<Object>} commits The commits the notes generator is rendering.
 * @param {Object} options
 * @param {String} options.owner The repository owner, from the changelog context.
 * @param {String} options.host The forge the profile link is built against.
 * @param {String} options.repository The repository the API lookups address.
 * @param {String} [options.api] The GitHub API base, for GitHub Enterprise.
 * @param {String} [options.token] Without it, only privacy addresses resolve.
 * @param {Function} [options.fetchImpl] Injected in tests.
 * @returns {Promise<Number>} How many commits were credited.
 */
export async function attachThanks(commits, {
  api = 'https://api.github.com',
  fetchImpl = fetch,
  host,
  owner,
  repository,
  token,
} = {}) {
  const logins = new Map();
  let credited = 0;

  for (const commit of commits) {
    const email = (commit.author?.email ?? commit.committer?.email ?? '').toLowerCase();

    if (!commit.hash || !email || commit.thanks) {
      continue;
    }

    if (!logins.has(email)) {
      logins.set(
        email,
        loginFromEmail(email)
          ?? (token ? await loginFromApi(commit.hash, { api, owner, repository, token, fetchImpl }) : null),
      );
    }

    const login = logins.get(email);

    if (!login || BOT_LOGIN.test(login) || login.toLowerCase() === owner.toLowerCase()) {
      continue;
    }

    commit.thanks = `[@${login}](${host}/${login})`;
    credited += 1;
  }

  return credited;
}
