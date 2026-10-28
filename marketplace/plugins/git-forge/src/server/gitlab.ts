/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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

import type { ForgeDetail, ForgeCommit, ForgeFile, ForgeItem, ForgeItemState, ForgeList, ForgeSection } from '../protocol';
import { capabilitiesFor } from './capabilities';
import { ciBadge } from './ci';
import { get, joinUrl, pageSize, withParams, type ForgeContext } from './context';
import { gitlabParams } from './filters';
import { asRecord, count, flag, labelsOf, listAt, numberish, recordAt, text, textAt } from './map';
import { gitlabProject } from './remote';

/** The project path every URL is built on. */
export function projectPath(context: ForgeContext): string {
  return `projects/${gitlabProject(context.slug)}`;
}

function issueItem(raw: unknown): ForgeItem | null {
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

function mergeItem(raw: unknown): ForgeItem | null {
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

function releaseItem(raw: unknown): ForgeItem | null {
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

export function itemUrl(context: ForgeContext, section: ForgeSection, id: string): string {
  const project = projectPath(context);
  const encoded = encodeURIComponent(id);
  if (section === 'issues') return joinUrl(context.apiBase, `${project}/issues/${encoded}`);
  if (section === 'pulls') return joinUrl(context.apiBase, `${project}/merge_requests/${encoded}`);
  return joinUrl(context.apiBase, `${project}/releases/${encoded}`);
}

function mergeFacts(record: Record<string, unknown>): Array<{ label: string; value: string }> {
  const facts: Array<{ label: string; value: string }> = [];
  const source = text(record.source_branch);
  const target = text(record.target_branch);
  if (source || target) facts.push({ label: 'branch', value: `${target || '?'} ← ${source || '?'}` });
  const changes = numberish(record.changes_count, -1);
  if (changes >= 0) facts.push({ label: 'files', value: String(changes) });
  if (record.has_conflicts === true) facts.push({ label: 'mergeable', value: 'conflicts' });
  else if (record.detailed_merge_status === 'mergeable') facts.push({ label: 'mergeable', value: 'yes' });
  return facts;
}

/**
 * The notes thread, with GitLab's own audit entries marked rather than dropped.
 *
 * A `system` note is "changed the description", "added 1 commit", "approved this
 * merge request" — not a reply, but also not nothing: an approval recorded only
 * as a system note is the one place a reader learns who approved. So the row is
 * kept and flagged, and the panel draws it as a line rather than as a message.
 */
async function readNotes(
  context: ForgeContext,
  section: ForgeSection,
  id: string,
  notes: string[],
): Promise<ForgeDetail['comments']> {
  if (section === 'releases') return [];
  const kind = section === 'issues' ? 'issues' : 'merge_requests';
  const url = withParams(
    joinUrl(context.apiBase, `${projectPath(context)}/${kind}/${encodeURIComponent(id)}/notes`),
    { per_page: '100', sort: 'asc' },
  );
  const result = await get(context, url);
  if (!result.ok) {
    notes.push(`comments: ${result.message}`);
    return [];
  }
  return listAt(result.value).flatMap((raw) => {
    const entry = asRecord(raw);
    if (!entry) return [];
    return [
      {
        id: String(count(entry.id, 0)),
        author: textAt(entry.author, 'username', 'unknown'),
        body: text(entry.body),
        createdAt: text(entry.created_at),
        url: null,
        system: flag(entry.system),
        bot: false,
      },
    ];
  });
}

/** The pipeline's verdict for a merge request, from its own detail. */
function pipelineOf(record: Record<string, unknown>): ForgeDetail['ci'] {
  const pipeline = recordAt(record, 'head_pipeline');
  if (!pipeline) return null;
  return ciBadge([text(pipeline.status)], text(pipeline.web_url) || null);
}

/** A merge request's changed files, from its own `changes` array. */
function filesOf(record: Record<string, unknown>): ForgeFile[] {
  return listAt(record.changes).flatMap((raw) => {
    const entry = asRecord(raw);
    if (!entry) return [];
    const path = text(entry.new_path) || text(entry.old_path);
    if (!path) return [];
    const renamed = flag(entry.renamed_file);
    return [
      {
        path,
        status: flag(entry.new_file) ? 'added' : flag(entry.deleted_file) ? 'removed' : renamed ? 'renamed' : 'modified',
        additions: 0,
        deletions: 0,
        patch: text(entry.diff),
      },
    ];
  });
}

/**
 * A merge request's commits.
 *
 * GitLab reports neither a count nor an author per commit on the MR object, so
 * this is a second read — and a failure is a note, because the diff and the
 * conversation are already on screen.
 */
async function readCommits(
  context: ForgeContext,
  id: string,
  notes: string[],
): Promise<ForgeCommit[]> {
  const url = joinUrl(context.apiBase, `${projectPath(context)}/merge_requests/${encodeURIComponent(id)}/commits`);
  const result = await get(context, url);
  if (!result.ok) {
    notes.push(`commits: ${result.message}`);
    return [];
  }
  return listAt(result.value).flatMap((raw) => {
    const entry = asRecord(raw);
    if (!entry) return [];
    const sha = text(entry.id) || text(entry.short_id);
    if (!sha) return [];
    return [
      {
        sha,
        message: text(entry.title) || text(entry.message).split('\n')[0],
        author: text(entry.author_name, 'unknown'),
        at: text(entry.authored_date) || text(entry.created_at),
      },
    ];
  });
}

export async function detailGitlab(
  context: ForgeContext,
  section: ForgeSection,
  id: string,
): Promise<ForgeDetail | { error: string }> {
  const notes: string[] = [];
  const result = await get(context, itemUrl(context, section, id));
  if (!result.ok) return { error: result.message };

  const record = asRecord(result.value) ?? {};
  const mapper = section === 'issues' ? issueItem : section === 'pulls' ? mergeItem : releaseItem;
  const item = mapper(record);
  if (!item) return { error: 'The host returned an item this plugin could not read.' };

  const facts: Array<{ label: string; value: string }> = [];
  if (section === 'pulls') facts.push(...mergeFacts(record));
  if (section === 'releases') {
    const tag = text(record.tag_name);
    if (tag) facts.push({ label: 'tag', value: tag });
  }

  const [comments, commits] = await Promise.all([
    readNotes(context, section, id, notes),
    section === 'pulls' ? readCommits(context, id, notes) : Promise.resolve([]),
  ]);

  return {
    item,
    body: text(record.description),
    comments,
    facts,
    files: section === 'pulls' ? filesOf(record) : [],
    commits,
    ci: section === 'pulls' ? pipelineOf(record) : null,
    capabilities: capabilitiesFor({ provider: 'gitlab', section, hasCredential: Boolean(context.token) }),
    notes,
  };
}
