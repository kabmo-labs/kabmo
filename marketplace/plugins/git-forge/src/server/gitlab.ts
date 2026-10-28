/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * GitLab's REST API (v4), transcribed into this plugin's own shapes.
 *
 * ## Issues and merge requests are two collections here
 *
 * Unlike GitHub, GitLab does not fold merge requests into the issue list, so the
 * two reads are genuinely independent — no filter, no double-counting. What it
 * does NOT have is a search endpoint that returns both, so the filters travel as
 * real parameters (`scope=assigned_to_me`, `labels`, `search`), which
 * `filters.ts` builds.
 *
 * ## The project is addressed by its URL-ENCODED path
 *
 * `group/sub/project` becomes `group%2Fsub%2Fproject` in the path, and a plain
 * `group/sub/project` would be read as three path segments and 404. That
 * encoding is done once, in `remote.ts`'s `gitlabProject`, because a second
 * implementation is how one read and one link disagree.
 *
 * ## The state vocabulary is GitLab's own
 *
 * `opened` rather than `open`, and a merge request reports `merged` only through
 * `state: 'merged'` — not a `merged_at` field. Reading GitHub's words here is
 * silently wrong in one direction: every open MR would read as closed.
 *
 * ## The pipeline is on the DETAIL, not the list
 *
 * Measured: `head_pipeline` is `failed` on `/merge_requests/:iid` and `null` on
 * every row of `/merge_requests`. A row badge would cost one request per row.
 */

import type { ForgeItem, ForgeItemState, ForgeList, ForgeSection } from '../protocol';
import { get, joinUrl, pageSize, withParams, type ForgeContext } from './context';
import { gitlabParams } from './filters';
import { asRecord, count, flag, labelsOf, listAt, text, textAt } from './map';
import { gitlabProject } from './remote';

/** The project path every URL is built on. */
export function projectPath(context: ForgeContext): string {
  return `projects/${gitlabProject(context.slug)}`;
}

export function issueItem(raw: unknown): ForgeItem | null {
  const record = asRecord(raw);
  if (!record) return null;
  const iid = count(record.iid, 0);
  if (!iid) return null;
  return {
    id: String(iid),
    number: iid,
    title: text(record.title, '(untitled)'),
    state: text(record.state) === 'closed' ? 'closed' : 'open',
    author: textAt(record.author, 'username', 'unknown'),
    updatedAt: text(record.updated_at),
    url: text(record.web_url),
    labels: labelsOf(record.labels),
    comments: count(record.user_notes_count, 0),
    tag: null,
  };
}

/**
 * A merge request's state.
 *
 * GitLab reports `merged` as a state of its own, so the check is on the word
 * rather than on a `merged_at` field — and a draft is still open, which is why
 * `draft`/`work_in_progress` are read after the state has been classified.
 */
export function mergeState(record: Record<string, unknown>): ForgeItemState {
  const state = text(record.state);
  if (state === 'merged') return 'merged';
  if (state === 'closed') return 'closed';
  return flag(record.draft) || flag(record.work_in_progress) ? 'draft' : 'open';
}

export function mergeItem(raw: unknown): ForgeItem | null {
  const record = asRecord(raw);
  if (!record) return null;
  const iid = count(record.iid, 0);
  if (!iid) return null;
  return {
    id: String(iid),
    number: iid,
    title: text(record.title, '(untitled)'),
    state: mergeState(record),
    author: textAt(record.author, 'username', 'unknown'),
    updatedAt: text(record.updated_at),
    url: text(record.web_url),
    labels: labelsOf(record.labels),
    comments: count(record.user_notes_count, 0),
    tag: null,
  };
}

export function releaseItem(raw: unknown): ForgeItem | null {
  const record = asRecord(raw);
  if (!record) return null;
  const tag = text(record.tag_name);
  if (!tag) return null;
  return {
    id: tag,
    number: null,
    title: text(record.name) || tag,
    // GitLab has an `upcoming` release too: one that is scheduled and has no
    // `released_at`. It is shown as a prerelease rather than as published,
    // because nothing has been released yet.
    state: text(record.released_at) ? 'published' : 'prerelease',
    author: textAt(record.commit, 'author_name', 'unknown'),
    updatedAt: text(record.released_at) || text(record.created_at),
    url: textAt(record._links, 'self'),
    labels: [],
    comments: 0,
    tag,
  };
}

async function readSection(
  context: ForgeContext,
  section: ForgeSection,
  notes: string[],
): Promise<{ items: ForgeItem[]; truncated: boolean; total: number | null }> {
  const perPage = pageSize(context);
  const project = projectPath(context);
  const collection = section === 'issues' ? 'issues' : section === 'pulls' ? 'merge_requests' : 'releases';
  const params: Record<string, string> = {
    per_page: String(perPage),
    ...(section === 'releases' ? {} : { order_by: 'updated_at' }),
    ...gitlabParams(section, context.filter),
  };
  const url = withParams(joinUrl(context.apiBase, `${project}/${collection}`), params);

  const result = await get(context, url);
  if (!result.ok) {
    // A project with no releases answers 404 on that endpoint while issues and
    // MRs read fine, so a missing releases collection is not an error.
    if (section === 'releases' && result.status === 404) return { items: [], truncated: false, total: null };
    notes.push(`${section}: ${result.message}`);
    return { items: [], truncated: false, total: null };
  }

  const mapper = section === 'issues' ? issueItem : section === 'pulls' ? mergeItem : releaseItem;
  const rows = listAt(result.value);
  const items = rows.map(mapper).filter((item): item is ForgeItem => item !== null);
  // GitLab reports the collection size on the response, and the cache stores the
  // body rather than the headers, so the count a row shows is the page's own.
  return { items, truncated: rows.length >= perPage, total: null };
}

export async function listGitlab(context: ForgeContext): Promise<ForgeList> {
  const notes: string[] = [];
  if (!context.token) {
    notes.push(
      'Reading anonymously: public projects only. Set GITLAB_TOKEN in the server environment, or run `glab auth login`, to read a private one.',
    );
  }

  const [issues, pulls, releases] = await Promise.all([
    readSection(context, 'issues', notes),
    readSection(context, 'pulls', notes),
    readSection(context, 'releases', notes),
  ]);

  return {
    provider: 'gitlab',
    host: context.host,
    slug: context.slug,
    webUrl: context.webUrl,
    filter: context.filter,
    sections: { issues, pulls, releases },
    notes,
  };
}
