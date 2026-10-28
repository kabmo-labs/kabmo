/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * GitHub's REST API, transcribed into this plugin's own shapes.
 *
 * ## The one fact that shapes this file: a pull request IS an issue
 *
 * `/repos/{owner}/{repo}/issues` returns pull requests too — they carry a
 * `pull_request` key — so the issues section must FILTER them out rather than
 * showing every PR twice under two headings. GitHub documents this explicitly
 * and there is no query parameter that removes them.
 *
 * ## Three endpoints, not one
 *
 * Issues, pull requests and releases are three collections with different
 * fields, and merging them would mean dropping what makes each one useful (a
 * release's tag, a PR's base branch). The panel shows them as three sections,
 * so they are read as three.
 *
 * ## A draft is its own state
 *
 * `state: 'open'` with `draft: true` is still open, and calling it "open"
 * hides the one fact a reviewer looks for first. A merged PR is likewise not a
 * closed one: `merged_at` is the difference, and GitHub reports it on the row.
 */

import type { ForgeDetail, ForgeItem, ForgeItemState, ForgeList, ForgeSection } from '../protocol';
import { get, joinUrl, pageSize, type ForgeContext } from './context';
import { asRecord, count, fieldAt, flag, labelsOf, listAt, text, textAt } from './map';

/** The issue shape, for the parts this plugin reads. */
function issueItem(raw: unknown): ForgeItem | null {
  const record = asRecord(raw);
  if (!record) return null;
  // A pull request is returned by the ISSUES endpoint; it belongs to the other
  // section and must not appear here.
  if (record.pull_request) return null;
  const number = count(record.number, 0);
  if (!number) return null;
  return {
    id: String(number),
    number,
    title: text(record.title, '(untitled)'),
    state: text(record.state) === 'closed' ? 'closed' : 'open',
    author: textAt(record.user, 'login', 'unknown'),
    updatedAt: text(record.updated_at),
    url: text(record.html_url),
    labels: labelsOf(record.labels),
    comments: count(record.comments, 0),
    tag: null,
  };
}

/** A pull request's state, which is three answers rather than two. */
function pullState(record: Record<string, unknown>): ForgeItemState {
  if (record.merged_at) return 'merged';
  if (text(record.state) === 'closed') return 'closed';
  return flag(record.draft) ? 'draft' : 'open';
}

function pullItem(raw: unknown): ForgeItem | null {
  const record = asRecord(raw);
  if (!record) return null;
  const number = count(record.number, 0);
  if (!number) return null;
  return {
    id: String(number),
    number,
    title: text(record.title, '(untitled)'),
    state: pullState(record),
    author: textAt(record.user, 'login', 'unknown'),
    updatedAt: text(record.updated_at),
    url: text(record.html_url),
    labels: labelsOf(record.labels),
    comments: count(record.comments, 0),
    tag: null,
  };
}

function releaseItem(raw: unknown): ForgeItem | null {
  const record = asRecord(raw);
  if (!record) return null;
  const tag = text(record.tag_name);
  if (!tag) return null;
  const published = text(record.published_at) || text(record.created_at);
  return {
    id: tag,
    number: null,
    title: text(record.name) || tag,
    state: flag(record.prerelease) ? 'prerelease' : 'published',
    author: textAt(record.author, 'login', 'unknown'),
    updatedAt: published,
    url: text(record.html_url),
    labels: [],
    comments: 0,
    tag,
  };
}

/** GitHub's own state word for a filter. */
function githubState(state: ForgeList['state']): string {
  return state === 'all' ? 'all' : state;
}

/**
 * Read one section. A failure is a note, never a failed read.
 *
 * **The issues section uses the SEARCH endpoint, and that is not a preference.**
 * `/repos/{owner}/{repo}/issues` returns pull requests too, and the documented
 * workaround is to filter them out of the response — which works until a page is
 * FULL of pull requests. Measured on `oven-sh/bun` with `state=open`: the five
 * newest "issues" were all pull requests, so filtering left **zero** issues on
 * screen while thousands were open. `search/issues?q=repo:x+is:issue` answers
 * exactly the issue collection, so the page is spent on issues.
 *
 * The search endpoint has its own, smaller rate limit (30 requests a minute
 * authenticated), which is why every read is conditional and cached — a panel
 * that re-read on each mount costs nothing while nothing changed. **One measured
 * exception**: GitHub's search endpoint answers with NO `ETag` and no
 * `Last-Modified`, so its re-read is always a full 200 — it is charged to the
 * search budget every time. The cache still serves as a failure record and keeps
 * the payload shape uniform; the per-minute cap is the reason the panel reads
 * only when it is the visible view, not because it is hidden.
 */
async function readSection(
  context: ForgeContext,
  section: ForgeSection,
  state: ForgeList['state'],
  notes: string[],
): Promise<{ items: ForgeItem[]; truncated: boolean }> {
  const asked = pageSize(context);
  const base = `/repos/${context.slug}`;
  const url =
    section === 'issues'
      ? joinUrl(
          context.apiBase,
          `/search/issues?q=${encodeURIComponent(`repo:${context.slug} is:issue${state === 'all' ? '' : ` state:${state}`}`)}&sort=updated&order=desc&per_page=${asked}`,
        )
      : section === 'pulls'
        ? joinUrl(context.apiBase, `${base}/pulls?state=${githubState(state)}&per_page=${asked}&sort=updated`)
        : joinUrl(context.apiBase, `${base}/releases?per_page=${asked}`);

  const result = await get(context, url);
  if (!result.ok) {
    notes.push(`${section}: ${result.message}`);
    return { items: [], truncated: false };
  }

  // The search endpoint wraps its rows in an envelope; the two REST collections
  // answer a bare array.
  const rows = section === 'issues' ? listAt(fieldAt(result.value, 'items')) : listAt(result.value);
  const mapper = section === 'issues' ? issueItem : section === 'pulls' ? pullItem : releaseItem;
  const items = rows.map(mapper).filter((item): item is ForgeItem => item !== null);
  const total = section === 'issues' ? count(fieldAt(result.value, 'total_count'), items.length) : items.length;
  return { items, truncated: total > items.length || rows.length >= asked };
}

/** All three sections, from three reads that each stand on their own. */
export async function listGithub(context: ForgeContext, state: ForgeList['state']): Promise<ForgeList> {
  const notes: string[] = [];
  if (!context.token) {
    notes.push(
      'Reading anonymously: public repositories only, at 60 requests an hour. Set GITHUB_TOKEN or GH_TOKEN in the server environment, or run `gh auth login`, to read a private one.',
    );
  }

  const [issues, pulls, releases] = await Promise.all([
    readSection(context, 'issues', state, notes),
    readSection(context, 'pulls', state, notes),
    readSection(context, 'releases', state, notes),
  ]);

  return {
    provider: 'github',
    host: context.host,
    slug: context.slug,
    webUrl: context.webUrl,
    state,
    sections: { issues, pulls, releases },
    notes,
  };
}

/** The issue-or-pull URL for one number, by section. */
function detailUrl(context: ForgeContext, section: ForgeSection, id: string): string {
  const base = `/repos/${context.slug}`;
  if (section === 'issues') return joinUrl(context.apiBase, `${base}/issues/${encodeURIComponent(id)}`);
  if (section === 'pulls') return joinUrl(context.apiBase, `${base}/pulls/${encodeURIComponent(id)}`);
  return joinUrl(context.apiBase, `${base}/releases/tags/${encodeURIComponent(id)}`);
}

/** A pull request's review facts, which no issue has. */
function pullFacts(record: Record<string, unknown>): Array<{ label: string; value: string }> {
  const facts: Array<{ label: string; value: string }> = [];
  const head = textAt(record.head, 'ref');
  const base = textAt(record.base, 'ref');
  if (head || base) facts.push({ label: 'branch', value: `${base || '?'} ← ${head || '?'}` });
  const additions = count(record.additions, -1);
  const deletions = count(record.deletions, -1);
  if (additions >= 0 && deletions >= 0) facts.push({ label: 'diff', value: `+${additions} −${deletions}` });
  const files = count(record.changed_files, 0);
  if (files > 0) facts.push({ label: 'files', value: String(files) });
  const mergeable = record.mergeable;
  if (mergeable === true) facts.push({ label: 'mergeable', value: 'yes' });
  else if (mergeable === false) facts.push({ label: 'mergeable', value: 'conflicts' });
  return facts;
}

/** One item's body, its conversation and whatever else the host reports. */
export async function detailGithub(
  context: ForgeContext,
  section: ForgeSection,
  id: string,
): Promise<ForgeDetail | { error: string }> {
  const notes: string[] = [];
  const result = await get(context, detailUrl(context, section, id));
  if (!result.ok) return { error: result.message };

  const record = asRecord(result.value) ?? {};
  const mapper = section === 'issues' ? issueItem : section === 'pulls' ? pullItem : releaseItem;
  // A pull request read through the issues endpoint is filtered out by the list
  // mapper; a DETAIL read of one is the user's explicit choice, so the pull
  // mapper is used and the filter is bypassed by reading it as a pull.
  const item = section === 'issues' && record.pull_request ? pullItem(record) : mapper(record);
  if (!item) return { error: 'The host returned an item this panel could not read.' };

  const facts: Array<{ label: string; value: string }> = [];
  if (section === 'pulls') facts.push(...pullFacts(record));
  if (section === 'releases') {
    const tag = text(record.tag_name);
    if (tag) facts.push({ label: 'tag', value: tag });
    const target = text(record.target_commitish);
    if (target) facts.push({ label: 'target', value: target });
  }
  if (section === 'issues') {
    const comments = count(record.comments, 0);
    if (comments > 0) facts.push({ label: 'comments', value: String(comments) });
  }

  // A release has no conversation thread; its body IS the note.
  const comments: ForgeDetail['comments'] = [];
  if (section !== 'releases') {
    const thread = await get(context, joinUrl(context.apiBase, `/repos/${context.slug}/issues/${encodeURIComponent(id)}/comments?per_page=100`));
    if (thread.ok) {
      for (const raw of listAt(thread.value)) {
        const entry = asRecord(raw);
        if (!entry) continue;
        comments.push({
          id: text(entry.node_id) || String(count(entry.id, comments.length)),
          author: textAt(entry.user, 'login', 'unknown'),
          body: text(entry.body),
          createdAt: text(entry.created_at),
          url: text(entry.html_url) || null,
        });
      }
    } else {
      notes.push(`comments: ${thread.message}`);
    }
  }

  return { item, body: text(record.body), comments, facts, notes };
}
