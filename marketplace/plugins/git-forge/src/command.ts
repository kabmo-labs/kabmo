/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `/issue <number>` — put an item's context in the composer.
 *
 * The composer is where a question about a ticket gets asked ("why does #42377
 * only happen under `--cpu-prof`?"), and retyping the title and the link is work
 * the panel already has the answer to. So the command reads the item and inserts
 * a QUOTATION — the title, the link, and the description's first paragraph — and
 * the reader types their question under it.
 *
 * Three rules, each of which is a bug shape if dropped:
 *
 * - **The id is parsed, not trusted.** `/issue 12`, `/issue #12` and `/issue
 *   https://github.com/o/n/issues/12` all mean the same thing, and anything else
 *   is refused with the usage line rather than read as a number.
 * - **Issues are tried first, then pull requests**, because the number alone
 *   cannot say which collection it belongs to and both are addressed by it.
 * - **The insert is an INSERT, not a `set`**: the reader may already have a
 *   draft, and replacing it would throw away what they wrote before they asked
 *   for context.
 */

import type { ForgeDetail, ForgeSection } from './protocol';
import { RPC } from './protocol';

/** The usage line, shown when the argument is not an id. */
export const USAGE = '/issue <number> — quote an issue or pull request into the prompt';

/**
 * The number in an argument, or null.
 *
 * The URL form is accepted because that is what a reader copies from a browser,
 * and it is read as the LAST path segment rather than by a regex over the whole
 * string: a repository named `issues` would otherwise make the path ambiguous.
 */
export function parseItemId(args: string): number | null {
  const trimmed = args.trim();
  if (!trimmed) return null;
  const fromUrl = trimmed.match(/\/(?:issues|pull|merge_requests)\/(\d+)\/?$/);
  if (fromUrl) return Number(fromUrl[1]);
  const bare = trimmed.replace(/^#/, '');
  if (!/^\d+$/.test(bare)) return null;
  const value = Number(bare);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** The first paragraph of a description, bounded — a quote, not a copy. */
export function firstParagraph(markdown: string, limit = 600): string {
  const body = markdown.replace(/\r\n/g, '\n').trim();
  if (!body) return '';
  const paragraph = body.split(/\n\s*\n/)[0].trim();
  const text = paragraph.length > limit ? `${paragraph.slice(0, limit).trimEnd()}…` : paragraph;
  // A quoted block: every line prefixed, so a heading or a fence inside the quote
  // cannot escape it and turn the prompt into the ticket's own markdown.
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

/**
 * The text to insert for one item.
 *
 * A blank line separates the quote from the cursor, and the divider sits AFTER
 * it: a `---` directly under a line of text is a setext heading in markdown, and
 * the timeline renders a user turn as markdown.
 */
export function quoteFor(detail: ForgeDetail): string {
  const item = detail.item;
  const id = item.number !== null ? `#${item.number}` : item.tag;
  // Both lines are quoted: a bare URL under a quoted title ends the block, and
  // the link then reads as the prompt's own text rather than as part of the
  // quotation.
  const head = `> ${id} ${item.title}\n> ${item.url}`;
  const body = firstParagraph(detail.body);
  return body ? `${head}\n>\n${body}\n\n---\n\n` : `${head}\n\n---\n\n`;
}

/** What a caller needs to run the command: the RPC and the composer's insert. */
export interface IssueCommandDeps {
  call: (method: string, input: unknown) => Promise<{ ok: boolean; value?: unknown; error?: { message: string } }>;
  insert: (text: string) => void;
  /** Where the repository is, or null when there is no workspace. */
  scope: { root: string; repo: string } | null;
  /** Reports a refusal where the reader is looking. */
  report: (message: string) => void;
}

/** The sections a bare number may name, in the order they are tried. */
const SECTIONS: readonly ForgeSection[] = ['issues', 'pulls'];

export async function runIssueCommand(args: string, deps: IssueCommandDeps): Promise<void> {
  const id = parseItemId(args);
  if (id === null) {
    deps.report(USAGE);
    return;
  }
  if (!deps.scope) {
    deps.report('/issue needs an open workspace with a repository.');
    return;
  }

  const reasons: string[] = [];
  for (const section of SECTIONS) {
    const outcome = await deps.call(RPC.detail, { ...deps.scope, section, id: String(id) });
    if (outcome.ok) {
      deps.insert(quoteFor(outcome.value as ForgeDetail));
      return;
    }
    if (outcome.error) reasons.push(outcome.error.message);
  }
  // Both collections refused: the first reason is the one that explains why (a
  // missing remote, a bad credential), and the second is usually the same.
  deps.report(reasons[0] ?? `No issue or pull request numbered ${id} in this repository.`);
}
