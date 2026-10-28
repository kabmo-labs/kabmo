/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * GitHub's REST API, transcribed into this plugin's own shapes.
 *
 * ## Issues and pull requests BOTH come from the search endpoint
 *
 * `/repos/{owner}/{repo}/issues` returns pull requests too — they carry a
 * `pull_request` key — and filtering them out works only while a page is not
 * full of them: measured on `oven-sh/bun` with `state=open`, the five newest
 * "issues" were all PRs, so filtering left ZERO issues on screen while 3 595
 * were open. `/repos/{id}/pulls` cannot filter by label, assignee or text at
 * all. Search answers both collections with the same qualifier grammar, so one
 * path serves the two sections AND the filters.
 *
 * The cost is stated rather than hidden:
 *
 * - search has its own budget (30/min authenticated) and sends **no `ETag`**, so
 *   its re-read is always a full response;
 * - a search row's `labels` are NAMES only, with no colour, so a list row's chips
 *   fall back to the theme's ink. The item's own page reads the REST object,
 *   which does carry colours.
 *
 * ## A pull request's state is three answers, not two
 *
 * `merged_at` is what makes a merged PR different from a closed one, and `draft`
 * is what makes a draft different from an open one. Both are on the search row
 * (`pull_request.merged_at`, `draft`), which is why the same mapper serves the
 * list and the detail.
 */

import type { ForgeDetail, ForgeItem, ForgeItemState, ForgeList, ForgeSection } from '../protocol';
import { capabilitiesFor } from './capabilities';
import { githubChecks, githubStatus } from './ci';
import { get, joinUrl, type ForgeContext } from './context';
import { githubSearch } from './filters';
import { githubExtras } from './github-extras';
import { asRecord, count, fieldAt, flag, labelsOf, listAt, recordAt, text, textAt } from './map';

/**
 * Whether a user object names a bot.
 *
 * GitHub sets `type: "Bot"` on an App's account and spells its login with a
 * `[bot]` suffix; both appear, and a row that reads a bot's "closed as duplicate"
 * as a human's reply is a row the reader has to re-read twice.
 */
export function isBotUser(raw: unknown): boolean {
  const login = textAt(raw, 'login');
  return textAt(raw, 'type') === 'Bot' || /\[bot\]$/.test(login) || /-bot$/.test(login);
}

/** An issue from a search row (which carries names, not coloured labels). */
export function issueItem(raw: unknown): ForgeItem | null {
  const record = asRecord(raw);
  if (!record) return null;
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

/**
 * A pull request's state, which is three answers rather than two.
 *
 * The merged marker has two spellings: the REST pull object carries `merged_at`
 * at the top level, while a SEARCH row carries it under `pull_request`. Reading
 * only one of them made the same PR report `merged` on its page and `closed` in
 * the list.
 */
export function pullState(record: Record<string, unknown>): ForgeItemState {
  const merged = record.merged_at || recordAt(record, 'pull_request')?.merged_at;
  if (merged) return 'merged';
  if (text(record.state) === 'closed') return 'closed';
  return flag(record.draft) ? 'draft' : 'open';
}

export function pullItem(raw: unknown): ForgeItem | null {
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

export function releaseItem(raw: unknown): ForgeItem | null {
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

/** The page size a read asks for, clamped to what the search endpoint accepts. */
function asked(context: ForgeContext): number {
  // Search caps `per_page` at 100; the REST endpoints accept the same ceiling.
  return Math.min(100, Math.max(1, Math.round(context.perPage)));
}

/** Read one section. A failure is a note, never a failed read. */
async function readSection(
  context: ForgeContext,
  section: ForgeSection,
  notes: string[],
): Promise<{ items: ForgeItem[]; truncated: boolean; total: number | null }> {
  const perPage = asked(context);
  const base = `/repos/${context.slug}`;
  const url =
    section === 'releases'
      ? joinUrl(context.apiBase, `${base}/releases?per_page=${perPage}`)
      : joinUrl(
          context.apiBase,
          `/search/issues?q=${encodeURIComponent(githubSearch(context.slug, section, context.filter))}&sort=updated&order=desc&per_page=${perPage}`,
        );

  const result = await get(context, url);
  if (!result.ok) {
    notes.push(`${section}: ${result.message}`);
    return { items: [], truncated: false, total: null };
  }

  // The search endpoint wraps its rows in an envelope; the REST collection
  // answers a bare array.
  const rows = section === 'releases' ? listAt(result.value) : listAt(fieldAt(result.value, 'items'));
  const mapper = section === 'issues' ? issueItem : section === 'pulls' ? pullItem : releaseItem;
  const items = rows.map(mapper).filter((item): item is ForgeItem => item !== null);
  const reported = section === 'releases' ? null : count(fieldAt(result.value, 'total_count'), items.length);
  const total = reported === 0 ? null : reported;
  return { items, truncated: total !== null ? total > items.length : rows.length >= perPage, total };
}

export async function listGithub(context: ForgeContext): Promise<ForgeList> {
  const notes: string[] = [];
  if (!context.token) {
    notes.push(
      'Reading anonymously: public repositories only. Set GITHUB_TOKEN or GH_TOKEN in the server environment, or run `gh auth login`, to read a private one.',
    );
  }

  const [issues, pulls, releases] = await Promise.all([
    readSection(context, 'issues', notes),
    readSection(context, 'pulls', notes),
    readSection(context, 'releases', notes),
  ]);

  return {
    provider: 'github',
    host: context.host,
    slug: context.slug,
    webUrl: context.webUrl,
    filter: context.filter,
    sections: { issues, pulls, releases },
    notes,
  };
}

/** The URL for one item, by section. */
export function itemUrl(context: ForgeContext, section: ForgeSection, id: string): string {
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

/** One item's conversation, with system and bot rows marked. */
async function readComments(
  context: ForgeContext,
  section: ForgeSection,
  id: string,
  notes: string[],
): Promise<ForgeDetail['comments']> {
  if (section === 'releases') return [];
  const result = await get(
    context,
    joinUrl(context.apiBase, `/repos/${context.slug}/issues/${encodeURIComponent(id)}/comments?per_page=100`),
  );
  if (!result.ok) {
    notes.push(`comments: ${result.message}`);
    return [];
  }
  return listAt(result.value).flatMap((raw) => {
    const entry = asRecord(raw);
    if (!entry) return [];
    return [
      {
        id: text(entry.node_id) || String(count(entry.id, 0)),
        author: textAt(entry.user, 'login', 'unknown'),
        body: text(entry.body),
        createdAt: text(entry.created_at),
        url: text(entry.html_url) || null,
        system: false,
        bot: isBotUser(entry.user),
      },
    ];
  });
}

/** The CI verdict for a pull request, from its head commit. */
async function readCi(
  context: ForgeContext,
  record: Record<string, unknown>,
  notes: string[],
): Promise<ForgeDetail['ci']> {
  const sha = textAt(record.head, 'sha');
  if (!sha) return null;
  // `head.html_url` is NULL on the pull payload — measured — so the run's page is
  // built from the slug and the sha. Without it the badge is inert text, and the
  // one thing a reader wants from a failing check is the log.
  const runUrl = textAt(record.head, 'html_url') || `https://${context.host}/${context.slug}/commit/${sha}/checks`;
  const checks = await get(context, joinUrl(context.apiBase, `/repos/${context.slug}/commits/${sha}/check-runs`));
  if (checks.ok) {
    const badge = githubChecks(checks.value, runUrl);
    if (badge) return badge;
  }
  // A repository using the older commit-status API has no check runs at all, and
  // answering "no CI" for one that has a red status is a wrong answer.
  const status = await get(context, joinUrl(context.apiBase, `/repos/${context.slug}/commits/${sha}/status`));
  if (status.ok) return githubStatus(status.value, runUrl);
  if (!checks.ok && !status.ok) notes.push(`checks: ${checks.message}`);
  return null;
}

export async function detailGithub(
  context: ForgeContext,
  section: ForgeSection,
  id: string,
): Promise<ForgeDetail | { error: string }> {
  const notes: string[] = [];
  const result = await get(context, itemUrl(context, section, id));
  if (!result.ok) return { error: result.message };

  const record = asRecord(result.value) ?? {};
  const mapper = section === 'issues' ? issueItem : section === 'pulls' ? pullItem : releaseItem;
  const item = mapper(record);
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

  const [comments, ci, extras] = await Promise.all([
    readComments(context, section, id, notes),
    section === 'pulls' ? readCi(context, record, notes) : Promise.resolve(null),
    section === 'pulls' ? githubExtras(context, id, notes) : Promise.resolve({ files: [], commits: [] }),
  ]);

  return {
    item,
    body: text(record.body),
    comments,
    facts,
    files: extras.files,
    commits: extras.commits,
    ci,
    capabilities: capabilitiesFor({ provider: 'github', section, hasCredential: Boolean(context.token) }),
    notes,
  };
}
