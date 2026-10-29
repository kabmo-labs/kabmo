/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Gitea / Forgejo's API (v1).
 *
 * The one host that puts issues and pull requests on a SINGLE endpoint, split by
 * `type=issues|pulls` — which is why `filters.ts` turns the section into a
 * parameter here rather than a path. It is also the host whose diff is served as
 * TEXT (`/pulls/:index.diff`), so its file list comes from `diff.ts` rather than
 * from a JSON collection.
 *
 * Four facts were checked against a running instance rather than assumed:
 *
 * - **`state` accepts `open`, `closed` and `all`**, and `all` is spelled that
 *   way — sending `state=open,closed` silently matches nothing.
 * - **A pull request IS an issue with `pull_request` set**, so the issues read
 *   must filter exactly as GitHub's does.
 * - **The number field is `number` for both**, not `index`; `index` appears only
 *   inside `pull_request` on some builds.
 * - **Comments live at `/issues/:index/comments`** even for a pull request,
 *   because a pull request is an issue — the `/pulls/:index/comments` route
 *   answers only the REVIEW comments, which is a different collection.
 */

import type {
  ForgeCommit,
  ForgeDetail,
  ForgeFile,
  ForgeItem,
  ForgeItemState,
  ForgeList,
  ForgeSection,
  ForgeSectionData,
} from '../protocol';
import { capabilitiesFor } from './capabilities';
import { ciBadge } from './ci';
import { get, getTextWith, joinUrl, pageSize, withParams, type ForgeContext } from './context';
import { parseUnifiedDiff } from './diff';
import { giteaParams } from './filters';
import { asRecord, count, flag, labelsOf, listAt, recordAt, text, textAt } from './map';

function issueItem(raw: unknown): ForgeItem | null {
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
 * A pull request's state.
 *
 * Gitea reports `merged` only through `merged_at`/`merged` on the pull object,
 * and a pull request row from the ISSUES endpoint carries `pull_request.merged_at`
 * instead — the same split GitHub has, and the same trap.
 */
export function giteaPullState(record: Record<string, unknown>): ForgeItemState {
  const nested = recordAt(record, 'pull_request');
  if (record.merged_at || nested?.merged_at || flag(record.merged) || flag(nested?.merged)) return 'merged';
  if (text(record.state) === 'closed') return 'closed';
  return 'open';
}

function pullItem(raw: unknown): ForgeItem | null {
  const record = asRecord(raw);
  if (!record) return null;
  const number = count(record.number, 0) || count(record.index, 0);
  if (!number) return null;
  return {
    id: String(number),
    number,
    title: text(record.title, '(untitled)'),
    state: giteaPullState(record),
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
  return {
    id: tag,
    number: null,
    title: text(record.name) || tag,
    state: flag(record.prerelease) ? 'prerelease' : 'published',
    author: textAt(record.author, 'login', 'unknown'),
    updatedAt: text(record.published_at) || text(record.created_at),
    url: text(record.html_url),
    labels: [],
    comments: 0,
    tag,
  };
}

async function readSection(
  context: ForgeContext,
  section: ForgeSection,
  notes: string[],
): Promise<ForgeSectionData> {
  const perPage = pageSize(context);
  const collection = section === 'releases' ? 'releases' : 'issues';
  const params: Record<string, string> = {
    limit: String(perPage),
    ...(section === 'releases' ? {} : giteaParams(section, context.filter)),
  };
  const url = withParams(joinUrl(context.apiBase, `/repos/${context.slug}/${collection}`), params);

  const result = await get(context, url);
  if (!result.ok) {
    // A project with no releases answers 404 while its issues read fine, so that
    // one is an EMPTY section rather than a failed read.
    if (section === 'releases' && result.status === 404) return { items: [], truncated: false, total: null, failed: false };
    notes.push(`${section}: ${result.message}`);
    return { items: [], truncated: false, total: null, failed: true };
  }

  const mapper = section === 'issues' ? issueItem : section === 'pulls' ? pullItem : releaseItem;
  // Gitea answers a bare array here; a future build that wraps it in
  // `{data: [...]}` is read through the same path.
  const rows = listAt(result.value).length > 0 ? listAt(result.value) : listAt(recordAt(result.value, 'data'));
  const items = rows.map(mapper).filter((item): item is ForgeItem => item !== null);
  return { items, truncated: rows.length >= perPage, total: null, failed: false };
}

export async function listGitea(context: ForgeContext): Promise<ForgeList> {
  const notes: string[] = [];
  if (!context.token) {
    notes.push(
      'Reading anonymously: public repositories only. Set GITEA_TOKEN in the server environment to read a private one.',
    );
  }

  const [issues, pulls, releases] = await Promise.all([
    readSection(context, 'issues', notes),
    readSection(context, 'pulls', notes),
    readSection(context, 'releases', notes),
  ]);

  return {
    provider: 'gitea',
    host: context.host,
    slug: context.slug,
    webUrl: context.webUrl,
    filter: context.filter,
    sections: { issues, pulls, releases },
    notes,
  };
}

export function itemUrl(context: ForgeContext, section: ForgeSection, id: string): string {
  const base = `/repos/${context.slug}`;
  if (section === 'issues') return joinUrl(context.apiBase, `${base}/issues/${encodeURIComponent(id)}`);
  if (section === 'pulls') return joinUrl(context.apiBase, `${base}/pulls/${encodeURIComponent(id)}`);
  return joinUrl(context.apiBase, `${base}/releases/tags/${encodeURIComponent(id)}`);
}

/** The pull request's changed files, parsed out of its `.diff` text. */
async function readFiles(context: ForgeContext, id: string, notes: string[]): Promise<ForgeFile[]> {
  const url = joinUrl(context.apiBase, `/repos/${context.slug}/pulls/${encodeURIComponent(id)}.diff`);
  const result = await getTextWith(context, url);
  if (!result.ok) {
    notes.push(`files: ${result.message}`);
    return [];
  }
  return typeof result.value === 'string' ? parseUnifiedDiff(result.value) : [];
}

async function readCommits(context: ForgeContext, id: string, notes: string[]): Promise<ForgeCommit[]> {
  const url = joinUrl(context.apiBase, `/repos/${context.slug}/pulls/${encodeURIComponent(id)}/commits`);
  const result = await get(context, url);
  if (!result.ok) {
    notes.push(`commits: ${result.message}`);
    return [];
  }
  return listAt(result.value).flatMap((raw) => {
    const entry = asRecord(raw);
    if (!entry) return [];
    const sha = text(entry.sha);
    if (!sha) return [];
    const commit = recordAt(entry, 'commit') ?? {};
    return [
      {
        sha,
        message: text(commit.message).split('\n')[0],
        author: textAt(commit.author, 'name', 'unknown'),
        at: textAt(commit.author, 'date'),
      },
    ];
  });
}

async function readComments(
  context: ForgeContext,
  id: string,
  notes: string[],
): Promise<ForgeDetail['comments']> {
  const url = withParams(joinUrl(context.apiBase, `/repos/${context.slug}/issues/${encodeURIComponent(id)}/comments`), {
    limit: '100',
  });
  const result = await get(context, url);
  if (!result.ok) {
    notes.push(`comments: ${result.message}`);
    return [];
  }
  return listAt(result.value).flatMap((raw) => {
    const entry = asRecord(raw);
    if (!entry) return [];
    const author = textAt(entry.user, 'login', 'unknown');
    return [
      {
        id: String(count(entry.id, 0)),
        author,
        body: text(entry.body),
        createdAt: text(entry.created_at),
        url: text(entry.html_url) || null,
        system: false,
        bot: /\[bot\]$/.test(author),
      },
    ];
  });
}

export async function detailGitea(
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
  if (!item) return { error: 'The host returned an item this plugin could not read.' };

  const facts: Array<{ label: string; value: string }> = [];
  if (section === 'pulls') {
    const head = textAt(record.head, 'ref');
    const base = textAt(record.base, 'ref');
    if (head || base) facts.push({ label: 'branch', value: `${base || '?'} ← ${head || '?'}` });
    const merged = flag(record.merged);
    if (merged) facts.push({ label: 'merged', value: 'yes' });
    else if (record.mergeable === false) facts.push({ label: 'mergeable', value: 'conflicts' });
  }
  if (section === 'releases') {
    const tag = text(record.tag_name);
    if (tag) facts.push({ label: 'tag', value: tag });
  }

  const [comments, files, commits] = await Promise.all([
    section === 'releases' ? Promise.resolve([]) : readComments(context, id, notes),
    section === 'pulls' ? readFiles(context, id, notes) : Promise.resolve([]),
    section === 'pulls' ? readCommits(context, id, notes) : Promise.resolve([]),
  ]);

  return {
    item,
    body: text(record.body),
    comments,
    facts,
    files,
    commits,
    // Gitea reports a commit's status per SHA and puts no badge on the pull
    // object, so a badge would cost a second read for a value the reader can
    // reach on the host in one click.
    ci: null,
    capabilities: capabilitiesFor({ provider: 'gitea', section, hasCredential: Boolean(context.token) }),
    notes,
  };
}

/**
 * The CI verdict for a commit, for a caller that has the SHA.
 *
 * Kept for a future row-level badge rather than deleted with the other CI reads:
 * Gitea DOES report a commit's combined status, and the only reason no badge is
 * drawn is that the pull object carries no SHA — reaching one costs a read the
 * panel has no other use for.
 */
export function giteaCommitCi(payload: unknown, url: string | null) {
  const status = recordAt(payload, 'combined_status') ?? recordAt(payload, 'status');
  const state = status ? text(status.state) : '';
  return state ? ciBadge([state], url) : null;
}
