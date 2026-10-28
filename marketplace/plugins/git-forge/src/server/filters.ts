/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Turning one filter into each host's own spelling.
 *
 * Four hosts, four grammars for the same three questions, and every one of them
 * has a quoting rule that fails silently when it is wrong:
 *
 * - **GitHub** answers a search endpoint whose `q` is a space-separated
 *   qualifier list. A value containing a space MUST be quoted (`label:"good
 *   first issue"`), or the search reads the second word as another qualifier and
 *   returns nothing — a filter that looks applied and matches zero rows.
 * - **GitLab** takes real parameters (`scope=assigned_to_me`, `labels`, `search`)
 *   and its own state word (`opened`), which `remote.ts`'s adapter already
 *   translates.
 * - **Gitea** also takes parameters, but spells the collection split as
 *   `type=issues|pulls` on ONE endpoint rather than two.
 * - **Bitbucket** has a query language (BBQL) and no parameter for labels.
 *
 * So the functions here are pure and per host: the adapter asks for its own
 * spelling, and the quoting rule lives beside the test that pins it rather than
 * inside a template string in the middle of a fetch.
 *
 * Everything is escaped for its grammar, including the free-text field, which is
 * the user's own typing: a `"` in it would otherwise close a quoted qualifier
 * and turn the rest of the line into search syntax.
 */

import type { ForgeFilter, ForgeSection } from '../protocol';

/**
 * A value for a quoted qualifier: inner quotes and backslashes escaped.
 *
 * GitHub's search does not document an escape, so the safe transformation is to
 * drop the quote character rather than emit `\"` (which it does not honour).
 * A label containing a quote is pathological; a filter that returns everything
 * is not an acceptable answer to it.
 */
export function quoted(value: string): string {
  return `"${value.replace(/["\\]/g, '')}"`;
}

/** A bare qualifier value: whitespace collapsed, so one field cannot add another qualifier. */
export function bare(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** The `q` for a GitHub search read. */
export function githubSearch(slug: string, section: ForgeSection, filter: ForgeFilter): string {
  const parts = [`repo:${slug}`, section === 'pulls' ? 'is:pr' : 'is:issue'];
  if (filter.state !== 'all') parts.push(`state:${filter.state}`);
  if (filter.mine) parts.push('assignee:@me');
  const label = bare(filter.label);
  // A space needs quoting or the second word becomes another qualifier; a QUOTE
  // needs it too, or the stripped character leaves an unbalanced value that the
  // host reads as an unterminated string and answers with nothing.
  if (label) parts.push(`label:${/[\s"]/.test(label) ? quoted(label) : label}`);
  const query = bare(filter.query);
  if (query) parts.push(query);
  return parts.join(' ');
}

/**
 * The parameters for a GitLab collection read.
 *
 * `scope=assigned_to_me` is the only spelling of "mine" GitLab accepts, and it is
 * mutually exclusive with `assignee_username` — sending both is a 400 rather
 * than a filter, which is why this returns one or the other.
 */
export function gitlabParams(section: ForgeSection, filter: ForgeFilter): Record<string, string> {
  const params: Record<string, string> = {};
  if (section !== 'releases') {
    if (filter.state === 'open') params.state = 'opened';
    else if (filter.state === 'closed') params.state = 'closed';
    if (filter.mine) params.scope = 'assigned_to_me';
    const label = bare(filter.label);
    if (label) params.labels = label;
    const query = bare(filter.query);
    if (query) params.search = query;
  }
  return params;
}

/**
 * The parameters for a Gitea collection read.
 *
 * Gitea puts issues and pull requests on ONE endpoint and splits them with
 * `type`, so the section decides a parameter rather than a path. `assigned=true`
 * is its spelling of "mine".
 */
export function giteaParams(section: ForgeSection, filter: ForgeFilter): Record<string, string> {
  const params: Record<string, string> = {};
  if (section === 'issues' || section === 'pulls') {
    params.type = section === 'pulls' ? 'pulls' : 'issues';
    params.state = filter.state;
    if (filter.mine) params.assigned = 'true';
    const label = bare(filter.label);
    if (label) params.labels = label;
    const query = bare(filter.query);
    if (query) params.q = query;
  }
  return params;
}

/**
 * The BBQL expression for a Bitbucket read.
 *
 * Bitbucket has no `labels` parameter, so a label filter becomes a query clause —
 * and its `state` vocabulary is `OPEN`/`MERGED`/`DECLINED`/`SUPERSEDED`, where
 * "closed" is three different words. Rather than guess which one the reader
 * meant, a `closed` filter is sent as the three closed states OR'd together,
 * which is what the host's own UI means by closed.
 */
export function bitbucketQuery(section: ForgeSection, filter: ForgeFilter): string {
  const clauses: string[] = [];
  if (section === 'pulls') {
    if (filter.state === 'open') clauses.push('state="OPEN"');
    else if (filter.state === 'closed') clauses.push('(state="MERGED" OR state="DECLINED" OR state="SUPERSEDED")');
  } else if (section === 'issues') {
    if (filter.state === 'open') clauses.push('state="new" OR state="open"');
    else if (filter.state === 'closed') {
      clauses.push('(state="closed" OR state="resolved" OR state="invalid" OR state="duplicate" OR state="wontfix")');
    }
  }
  const label = bare(filter.label);
  if (label) clauses.push(`labels ~ ${quoted(label)}`);
  const query = bare(filter.query);
  if (query) clauses.push(`title ~ ${quoted(query)}`);
  return clauses.join(' AND ');
}

/** Whether a filter would change what a read returns. */
export function filtersAnything(filter: ForgeFilter): boolean {
  return filter.state !== 'open' || filter.mine || bare(filter.label) !== '' || bare(filter.query) !== '';
}
