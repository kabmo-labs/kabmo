/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Bitbucket Cloud's API (2.0).
 *
 * The odd one out in four ways, and each is why this adapter exists rather than
 * a shared "rest" one:
 *
 * - **The API is on another hostname** (`api.bitbucket.org/2.0`), so the root
 *   cannot be derived from the remote — `remote.ts` states it.
 * - **Every collection is a paged envelope** (`{values: [...], next: "..."}`),
 *   never a bare array, so every read goes through `valuesOf`.
 * - **The vocabulary is uppercase** (`OPEN`, `MERGED`, `DECLINED`, `SUPERSEDED`)
 *   and a pull request has no `draft` flag — a draft is a title prefix, and the
 *   host's own UI shows it that way.
 * - **A pull request's diff is TEXT** (`/pullrequests/:id/diff`), so its file
 *   list comes from the shared parser rather than from a JSON collection.
 *
 * Two consequences are visible in the panel and are stated rather than hidden:
 * the label filter becomes a BBQL clause (there is no `labels` parameter), and a
 * "closed" pull request is three states OR'd together, because one word cannot
 * say which one the reader meant.
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
import { get, getTextWith, joinUrl, pageSize, withParams, type ForgeContext } from './context';
import { parseUnifiedDiff } from './diff';
import { bitbucketQuery } from './filters';
import { asRecord, count, fieldAt, flag, hrefAt, listAt, recordAt, text, textAt } from './map';
import { bitbucketPath } from './remote';

/** The repository's own path: Bitbucket addresses a workspace and a repo separately. */
function repoPath(context: ForgeContext): string | null {
  const parts = bitbucketPath(context.slug);
  if (!parts) return null;
  return `repositories/${encodeURIComponent(parts.workspace)}/${encodeURIComponent(parts.repo)}`;
}

/** A paged envelope's rows. Bitbucket never answers a bare array. */
function valuesOf(value: unknown): unknown[] {
  return listAt(fieldAt(value, 'values'));
}

/** Bitbucket's state word, mapped to ours. */
export function bitbucketState(word: string): ForgeItemState {
  const state = word.toUpperCase();
  if (state === 'MERGED') return 'merged';
  if (state === 'DECLINED' || state === 'SUPERSEDED') return 'closed';
  return 'open';
}

function issueItem(raw: unknown): ForgeItem | null {
  const record = asRecord(raw);
  if (!record) return null;
  const id = count(record.id, 0);
  if (!id) return null;
  // Bitbucket's issue `state` is `new|open|resolved|invalid|duplicate|wontfix`,
  // so only the first two are open.
  const state = text(record.state).toLowerCase();
  return {
    id: String(id),
    number: id,
    title: text(record.title, '(untitled)'),
    state: state === 'new' || state === 'open' || state === '' ? 'open' : 'closed',
    author: textAt(record.reporter, 'nickname', textAt(record.reporter, 'display_name', 'unknown')),
    updatedAt: text(record.updated_on),
    url: hrefAt(record, 'links', 'html', 'href'),
    // Bitbucket issues have no label collection at all; `kind` is a single
    // `bug`/`enhancement` word, and drawing it as a label would invent a set.
    labels: [],
    comments: count(record.comment_count, 0),
    tag: null,
  };
}

function pullItem(raw: unknown): ForgeItem | null {
  const record = asRecord(raw);
  if (!record) return null;
  const id = count(record.id, 0);
  if (!id) return null;
  return {
    id: String(id),
    number: id,
    title: text(record.title, '(untitled)'),
    state: bitbucketState(text(record.state, 'OPEN')),
    author: textAt(record.author, 'nickname', textAt(record.author, 'display_name', 'unknown')),
    updatedAt: text(record.updated_on),
    url: hrefAt(record, 'links', 'html', 'href'),
    labels: [],
    comments: count(record.comment_count, 0),
    tag: null,
  };
}

function tagItem(raw: unknown): ForgeItem | null {
  const record = asRecord(raw);
  if (!record) return null;
  const name = text(record.name);
  if (!name) return null;
  return {
    id: name,
    number: null,
    title: name,
    state: 'published',
    author: textAt(record.author, 'display_name', textAt(record.author, 'nickname', 'unknown')),
    updatedAt: text(record.date),
    url: hrefAt(record, 'links', 'html', 'href'),
    labels: [],
    comments: 0,
    tag: name,
  };
}

async function readSection(
  context: ForgeContext,
  section: ForgeSection,
  notes: string[],
): Promise<ForgeSectionData> {
  const repo = repoPath(context);
  if (!repo) {
    notes.push(`${section}: Bitbucket addresses a repository as workspace/repo, and "${context.slug}" is not that.`);
    return { items: [], truncated: false, total: null, failed: true };
  }

  const collection = section === 'issues' ? 'issues' : section === 'pulls' ? 'pullrequests' : 'refs/tags';
  const query = bitbucketQuery(section, context.filter);
  const url = withParams(joinUrl(context.apiBase, `${repo}/${collection}`), {
    pagelen: String(pageSize(context)),
    ...(query ? { q: query } : {}),
  });

  const result = await get(context, url);
  if (!result.ok) {
    if (section === 'releases' && result.status === 404) return { items: [], truncated: false, total: null, failed: false };
    notes.push(`${section}: ${result.message}`);
    return { items: [], truncated: false, total: null, failed: true };
  }

  const mapper = section === 'issues' ? issueItem : section === 'pulls' ? pullItem : tagItem;
  const rows = valuesOf(result.value);
  const items = rows.map(mapper).filter((item): item is ForgeItem => item !== null);
  const size = count(fieldAt(result.value, 'size'), -1);
  return {
    items,
    truncated: size > items.length || Boolean(fieldAt(result.value, 'next')),
    total: size >= 0 ? size : null,
    failed: false,
  };
}

export async function listBitbucket(context: ForgeContext): Promise<ForgeList> {
  const notes: string[] = [];
  if (!context.token) {
    notes.push(
      'Reading anonymously: public repositories only. Set BITBUCKET_TOKEN in the server environment (an access token, or `user:app-password`) to read a private one.',
    );
  }

  const [issues, pulls, releases] = await Promise.all([
    readSection(context, 'issues', notes),
    readSection(context, 'pulls', notes),
    readSection(context, 'releases', notes),
  ]);

  return {
    provider: 'bitbucket',
    host: context.host,
    slug: context.slug,
    webUrl: context.webUrl,
    filter: context.filter,
    sections: { issues, pulls, releases },
    notes,
  };
}

export function itemUrl(context: ForgeContext, section: ForgeSection, id: string): string {
  const repo = repoPath(context) ?? '';
  const encoded = encodeURIComponent(id);
  if (section === 'issues') return joinUrl(context.apiBase, `${repo}/issues/${encoded}`);
  if (section === 'pulls') return joinUrl(context.apiBase, `${repo}/pullrequests/${encoded}`);
  return joinUrl(context.apiBase, `${repo}/refs/tags/${encoded}`);
}

async function readComments(
  context: ForgeContext,
  section: ForgeSection,
  id: string,
  notes: string[],
): Promise<ForgeDetail['comments']> {
  const repo = repoPath(context) ?? '';
  const collection = section === 'pulls' ? 'pullrequests' : 'issues';
  const url = withParams(joinUrl(context.apiBase, `${repo}/${collection}/${encodeURIComponent(id)}/comments`), {
    pagelen: '100',
  });
  const result = await get(context, url);
  if (!result.ok) {
    notes.push(`comments: ${result.message}`);
    return [];
  }
  return valuesOf(result.value).flatMap((raw) => {
    const entry = asRecord(raw);
    if (!entry) return [];
    const author = textAt(entry.user, 'nickname', textAt(entry.user, 'display_name', 'unknown'));
    // Bitbucket's deleted comments keep their place with a tombstone body, which
    // is not something the reader can act on.
    if (flag(entry.deleted)) return [];
    return [
      {
        id: String(count(entry.id, 0)),
        author,
        body: textAt(entry.content, 'raw'),
        createdAt: text(entry.created_on),
        url: null,
        system: false,
        bot: /\[bot\]$/.test(author),
      },
    ];
  });
}

/** The pull request's changed files, parsed out of its `.diff` text. */
async function readFiles(context: ForgeContext, id: string, notes: string[]): Promise<ForgeFile[]> {
  const repo = repoPath(context) ?? '';
  const result = await getTextWith(context, joinUrl(context.apiBase, `${repo}/pullrequests/${encodeURIComponent(id)}/diff`));
  if (!result.ok) {
    notes.push(`files: ${result.message}`);
    return [];
  }
  return typeof result.value === 'string' ? parseUnifiedDiff(result.value) : [];
}

async function readCommits(context: ForgeContext, id: string, notes: string[]): Promise<ForgeCommit[]> {
  const repo = repoPath(context) ?? '';
  const result = await get(
    context,
    joinUrl(context.apiBase, `${repo}/pullrequests/${encodeURIComponent(id)}/commits?pagelen=50`),
  );
  if (!result.ok) {
    notes.push(`commits: ${result.message}`);
    return [];
  }
  return valuesOf(result.value).flatMap((raw) => {
    const entry = asRecord(raw);
    if (!entry) return [];
    const sha = text(entry.hash);
    if (!sha) return [];
    return [
      {
        sha,
        message: text(entry.message).split('\n')[0],
        author: textAt(entry.author, 'raw', 'unknown').replace(/\s*<[^>]*>\s*$/, ''),
        at: text(entry.date),
      },
    ];
  });
}

export async function detailBitbucket(
  context: ForgeContext,
  section: ForgeSection,
  id: string,
): Promise<ForgeDetail | { error: string }> {
  const notes: string[] = [];
  const result = await get(context, itemUrl(context, section, id));
  if (!result.ok) return { error: result.message };

  const record = asRecord(result.value) ?? {};
  const mapper = section === 'issues' ? issueItem : section === 'pulls' ? pullItem : tagItem;
  const item = mapper(record);
  if (!item) return { error: 'The host returned an item this plugin could not read.' };

  const facts: Array<{ label: string; value: string }> = [];
  if (section === 'pulls') {
    // `source.branch.name`, and `links.html.href` — two levels, which is why the
    // nested reads are explicit rather than one `textAt` call with three
    // arguments (that form reads the middle one as a FALLBACK).
    const source = textAt(recordAt(recordAt(record, 'source'), 'branch'), 'name');
    const target = textAt(recordAt(recordAt(record, 'destination'), 'branch'), 'name');
    if (source || target) facts.push({ label: 'branch', value: `${target || '?'} ← ${source || '?'}` });
    const reviewers = listAt(fieldAt(record, 'reviewers'));
    if (reviewers.length > 0) facts.push({ label: 'reviewers', value: String(reviewers.length) });
    if (flag(record.close_source_branch)) facts.push({ label: 'closes branch', value: 'yes' });
  }

  const [comments, files, commits] = await Promise.all([
    section === 'releases' ? Promise.resolve([]) : readComments(context, section, id, notes),
    section === 'pulls' ? readFiles(context, id, notes) : Promise.resolve([]),
    section === 'pulls' ? readCommits(context, id, notes) : Promise.resolve([]),
  ]);

  return {
    item,
    // Bitbucket keeps a description in `content.raw`, not `body`/`description`.
    body:
      textAt(recordAt(record, 'content'), 'raw') ||
      text(record.description) ||
      textAt(recordAt(record, 'summary'), 'raw'),
    comments,
    facts,
    files,
    commits,
    // A pull request carries no pipeline; its status lives on the commit and on
    // a pipelines endpoint this panel does not read.
    ci: null,
    capabilities: capabilitiesFor({ provider: 'bitbucket', section, hasCredential: Boolean(context.token) }),
    notes,
  };
}
