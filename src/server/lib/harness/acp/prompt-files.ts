/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The files a prompt mentions, as ACP `resource_link` blocks.
 *
 * `@path` is omp's own mention syntax and omp expands it into file contents. No
 * other ACP agent does: they receive the raw text, so "look at @src/app.ts"
 * reaches the model as a path with no bytes behind it. ACP's answer is a
 * `resource_link` block — a URI the agent resolves through the `fs/*` surface
 * this client already serves — and that is what this module builds.
 *
 * Only paths that exist and stay inside the session's workspace become links. A
 * `@claude`/`@agent` mention resolves to nothing and is dropped, and so is an
 * escaped path, because a link the agent cannot read is worse than a mention the
 * agent ignores.
 */

import path from 'node:path';

export interface PromptFileLink {
  uri: string;
  name: string;
}

/** `@path`, `@"path with spaces"`, `@'path'` — the three forms the composer writes. */
const MENTION_RE = /(^|[\s([{])@(?:"([^"]+)"|'([^']+)'|(\S+))/g;

/** Trailing prose punctuation that is never part of a path. */
const TRAILING_PUNCT_RE = /[.,;:!?)\]}]+$/;

/** Does `target` stay inside `root`? Pure string math; the link is only SENT,
 *  so a symlink that escapes costs nothing here — `fs/read_text_file` refuses
 *  it on the way back. */
function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** Every mention that names a readable file inside the session workspace. */
export async function promptFileLinks(cwd: string, text: string): Promise<PromptFileLink[]> {
  const root = path.resolve(cwd);
  const seen = new Set<string>();
  const links: PromptFileLink[] = [];
  for (const match of text.matchAll(MENTION_RE)) {
    const raw = (match[2] ?? match[3] ?? match[4] ?? '').replace(TRAILING_PUNCT_RE, '');
    if (!raw || raw.includes('://')) continue;
    const absolute = path.resolve(root, raw);
    if (seen.has(absolute) || !inside(root, absolute)) continue;
    seen.add(absolute);
    const file = Bun.file(absolute);
    if (!(await file.exists())) continue;
    links.push({ uri: `file://${absolute}`, name: path.basename(absolute) });
  }
  return links;
}
