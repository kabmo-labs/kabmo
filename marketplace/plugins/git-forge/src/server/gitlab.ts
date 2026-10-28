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
 * two reads are genuinely independent — no filter, no double-counting.
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
 */

import type { ForgeDetail, ForgeItem, ForgeItemState, ForgeList, ForgeSection } from '../protocol';
import { get, joinUrl, pageSize, type ForgeContext } from './context';
import { asRecord, count, flag, listAt, labelsOf, numberish, text, textAt } from './map';
import { gitlabProject } from './remote';

/** The project path every URL is built on. */
function projectPath(context: ForgeContext): string {
  return `projects/${gitlabProject(context.slug)}`;
}

/** GitLab's own word for a filter state. */
function gitlabState(state: ForgeList['state']): string {
  if (state === 'open') return 'opened';
  return state;
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
function mergeState(record: Record<string, unknown>): ForgeItemState {
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
  state: ForgeList['state'],
  notes: string[],
): Promise<{ items: ForgeItem[]; truncated: boolean }> {
  const asked = pageSize(context);
  const project = projectPath(context);
  const url =
    section === 'issues'
      ? joinUrl(context.apiBase, `${project}/issues?state=${gitlabState(state)}&per_page=${asked}&order_by=updated_at`)
      : section === 'pulls'
        ? joinUrl(context.apiBase, `${project}/merge_requests?state=${gitlabState(state)}&per_page=${asked}&order_by=updated_at`)
        : joinUrl(context.apiBase, `${project}/releases?per_page=${asked}`);

  const result = await get(context, url);
  if (!result.ok) {
    // A project with no releases answers 404 on that endpoint while issues and
    // MRs read fine, so a missing releases collection is not an error.
    if (section === 'releases' && result.status === 404) return { items: [], truncated: false };
    notes.push(`${section}: ${result.message}`);
    return { items: [], truncated: false };
  }

  const mapper = section === 'issues' ? issueItem : section === 'pulls' ? mergeItem : releaseItem;
  const rows = listAt(result.value);
  const items = rows.map(mapper).filter((item): item is ForgeItem => item !== null);
  return { items, truncated: rows.length >= asked };
}

export async function listGitlab(context: ForgeContext, state: ForgeList['state']): Promise<ForgeList> {
  const notes: string[] = [];
  if (!context.token) {
    notes.push(
      'Reading anonymously: public projects only. Set GITLAB_TOKEN in the server environment, or run `glab auth login`, to read a private one.',
    );
  }

  const [issues, pulls, releases] = await Promise.all([
    readSection(context, 'issues', state, notes),
    readSection(context, 'pulls', state, notes),
    readSection(context, 'releases', state, notes),
  ]);

  return {
    provider: 'gitlab',
    host: context.host,
    slug: context.slug,
    webUrl: context.webUrl,
    state,
    sections: { issues, pulls, releases },
    notes,
  };
}

function detailUrl(context: ForgeContext, section: ForgeSection, id: string): string {
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
  const pipeline = textAt(record.head_pipeline, 'status');
  if (pipeline) facts.push({ label: 'pipeline', value: pipeline });
  return facts;
}

export async function detailGitlab(
  context: ForgeContext,
  section: ForgeSection,
  id: string,
): Promise<ForgeDetail | { error: string }> {
  const notes: string[] = [];
  const result = await get(context, detailUrl(context, section, id));
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

  // Issues and merge requests both carry a NOTES thread; a release carries its
  // description and no conversation.
  const comments: ForgeDetail['comments'] = [];
  if (section !== 'releases') {
    const kind = section === 'issues' ? 'issues' : 'merge_requests';
    const thread = await get(
      context,
      joinUrl(context.apiBase, `${projectPath(context)}/${kind}/${encodeURIComponent(id)}/notes?per_page=100&sort=asc`),
    );
    if (thread.ok) {
      for (const raw of listAt(thread.value)) {
        const entry = asRecord(raw);
        if (!entry) continue;
        // System notes are GitLab's own audit trail ("changed the description",
        // "added 1 commit"), and they are not part of the conversation.
        if (flag(entry.system)) continue;
        comments.push({
          id: String(count(entry.id, comments.length)),
          author: textAt(entry.author, 'username', 'unknown'),
          body: text(entry.body),
          createdAt: text(entry.created_at),
          url: null,
        });
      }
    } else {
      notes.push(`comments: ${thread.message}`);
    }
  }

  return { item, body: text(record.description), comments, facts, notes };
}
