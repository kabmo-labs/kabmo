/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which renderer an artifact omp spilled to disk should go through.
 *
 * The "Full output" reader used to put the whole stream in a `<pre>`, which is
 * wrong for every shape omp actually spills — measured over the 1,684 artifacts
 * of one install: 696 `bash-original` (505 plain logs, 156 markdown documents,
 * 32 JSON bodies, 3 numbered code excerpts), 228 `eval` (119 of them JSON), 70
 * `read` (44 markdown fetched from a URL), and 184 carrying a `git diff`. Raw,
 * a JSON dump arrives unformatted, a numbered excerpt welds its gutter onto the
 * code, and a markdown body shows its `#`/`|` source.
 *
 * The ORDER below is the whole contract and each step was a bug first:
 *
 *  1. **diff before everything.** A unified diff opens `--- a/x`, and `--- `
 *     matches the markdown list rule, so a diff classified later arrives as
 *     markdown and renders as prose.
 *  2. **json by the WHOLE payload.** `detectOutputFormat` refuses a JSON body
 *     over 100 kB, which is exactly the `eval` dump this reader exists for, so
 *     the brace test and the parse are done here without that cap.
 *  3. **code by its gutter.** `parseNumberedCode` is the same predicate the
 *     `read`/`edit` panels use, so an excerpt is not re-derived differently.
 *  4. markdown, then plain text.
 *
 * Pure and DOM-free: the modal's dispatch is testable without a renderer.
 */

import { detectOutputFormat } from '@/shared/lib/chat/detect-format';
import { parseNumberedCode } from '@/shared/lib/code/parser';
import { isExcerptDiff } from '@/shared/lib/fs/excerpt-diff';

/** The renderer a payload needs. `markdown` and `text` share one pipeline; the
 *  distinction is kept because it is what decides whether the payload is fenced
 *  verbatim or parsed as prose. */
export type ArtifactViewKind = 'diff' | 'json' | 'code' | 'markdown' | 'text';

/** A unified diff's own headers. `@@`/`---`/`+++` alone are also markdown. */
const UNIFIED_DIFF_RE = /^(?:diff --git |--- |\+\+\+ |@@ )/m;
/** An excerpt diff's gutter row that carries a change sign. */
const EXCERPT_CHANGE_RE = /^\s*[-+]\s*\d+\|/m;

/**
 * True when `text` is a diff — omp's excerpt dialect or git's unified one.
 *
 * Only the HEAD is tested, and both dialects are required to carry their own
 * marker: a unified diff by its headers, an excerpt by a `-N|`/`+N|` row. The
 * second condition is load-bearing rather than a tidy-up — a `read` of a file
 * prints its own `N|text` gutter, which `isExcerptDiff` alone accepts as
 * context rows, so a numbered code listing was classified as a diff and had its
 * gutter painted as change markers. A diff always has at least one change.
 */
export function looksLikeDiff(text: string): boolean {
  const head = text.split(/\r?\n/, 200).join('\n');
  if (UNIFIED_DIFF_RE.test(text.split(/\r?\n/, 8).join('\n'))) return true;
  return isExcerptDiff(head) && EXCERPT_CHANGE_RE.test(head);
}

/** The renderer for one artifact's text. */
export function artifactViewKind(text: string): ArtifactViewKind {
  const trimmed = text.trim();
  if (!trimmed) return 'text';
  if (looksLikeDiff(text)) return 'diff';
  // The WHOLE payload must be JSON, not a log that merely contains one, and
  // `detectOutputFormat`'s 100 kB cap is deliberately not reused: a large
  // `eval` dump is the case this reader exists for.
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed !== null && typeof parsed === 'object') return 'json';
    } catch {
      // not a JSON body — keep classifying
    }
  }
  if (parseNumberedCode(text).hasLineNumbers) return 'code';
  return detectOutputFormat(text) === 'markdown' ? 'markdown' : 'text';
}
