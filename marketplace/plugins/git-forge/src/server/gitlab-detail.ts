/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * GitLab's DETAIL read: one item, plus the four sub-resources that make it
 * readable.
 *
 * Split from `gitlab.ts` because the two answer different questions — the list is
 * three collections, the detail is one item and its conversation, change, commits
 * and pipeline — and because a merge request's files are NOT on the merge request
 * (see `readFiles`).
 */

import type { ForgeCommit, ForgeDetail, ForgeFile, ForgeSection } from '../protocol';
import { capabilitiesFor } from './capabilities';
import { ciBadge } from './ci';
import { get, joinUrl, withParams, type ForgeContext } from './context';
import { asRecord, count, flag, listAt, numberish, recordAt, text, textAt } from './map';
import { issueItem, mergeItem, projectPath, releaseItem } from './gitlab';

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

/**
 * A merge request's changed files.
 *
 * They are NOT on the merge request itself: measured on a real project, the
 * detail payload carries `changes_count: "15"` and NO `changes` array, and the
 * files live at `/merge_requests/:iid/changes`. Reading the array off the detail
 * reported zero files for every merge request — a wrong answer that looks like a
 * small change.
 */
async function readFiles(
  context: ForgeContext,
  id: string,
  notes: string[],
): Promise<ForgeFile[]> {
  const url = joinUrl(context.apiBase, `${projectPath(context)}/merge_requests/${encodeURIComponent(id)}/changes`);
  const result = await get(context, url);
  if (!result.ok) {
    notes.push(`files: ${result.message}`);
    return [];
  }
  return filesOf(asRecord(result.value) ?? {});
}

/** The `changes` array, mapped. */
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

  const [comments, commits, files] = await Promise.all([
    readNotes(context, section, id, notes),
    section === 'pulls' ? readCommits(context, id, notes) : Promise.resolve([]),
    section === 'pulls' ? readFiles(context, id, notes) : Promise.resolve([]),
  ]);

  return {
    item,
    body: text(record.description),
    comments,
    facts,
    files,
    commits,
    ci: section === 'pulls' ? pipelineOf(record) : null,
    capabilities: capabilitiesFor({ provider: 'gitlab', section, hasCredential: Boolean(context.token) }),
    notes,
  };
}
