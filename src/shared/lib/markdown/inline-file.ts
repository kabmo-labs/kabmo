/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Inline code that names a file the editor can open.
 *
 * An agent writes `` `src/hooks/use-file.ts:42` `` in prose far more often than
 * it writes a markdown link, and the timeline rendered that as an inert chip.
 * The renderer's own markup is the seam: `marked.ts` emits exactly
 * `<code class="inline-code">…</code>`, so the marker pass rewrites that one
 * shape and nothing else. It runs on the SANITIZED chat HTML, which is why the
 * attributes need no DOMPurify allow-list entry — the same contract
 * `markLocalImageSources` documents.
 *
 * Detection is deliberately conservative, because a false positive is a tab
 * that fails to read. It accepts only what a workspace file plausibly is:
 *
 *  - a path segment list that ends in a name the editor can show — a text
 *    extension (`TEXT_FILE_EXTENSIONS`), a viewer extension (raster image,
 *    SVG, PDF), or an extensionless project file (`Makefile`, `LICENSE`);
 *  - optionally suffixed by a line (`:42`, `:42-50`, `:42:7`) or GitHub's
 *    `#L42`, which become the editor's line reveal.
 *
 * Everything else stays plain text: commands (`bun test`), identifiers
 * (`state.user.id`), URLs, absolute paths, globs, shell flags, quoted strings
 * and anything containing whitespace. A bare filename is accepted HERE; the
 * click path resolves where it lives (see `chooseFileTarget`).
 */

import { TEXT_FILE_EXTENSIONS } from '@/shared/lib/chat/text-file';

/** One file reference written inside inline code. */
export interface InlineFileReference {
  /** Workspace-relative path, exactly as the click handler hands it to a tab. */
  path: string;
  /** 1-based line, when the code span named one. */
  line?: number;
}

/** The attribute the marker puts on a code span, read by the click handler. */
export const INLINE_FILE_ATTRIBUTE = 'data-file-path';
/** The 1-based line, when the span named one. */
export const INLINE_FILE_LINE_ATTRIBUTE = 'data-file-line';

/** Raster images, SVG and PDF: the editor has a viewer for each. */
const VIEWER_EXTENSIONS: Record<string, true> = {
  png: true,
  jpg: true,
  jpeg: true,
  gif: true,
  webp: true,
  avif: true,
  bmp: true,
  ico: true,
  svg: true,
  pdf: true,
};

/**
 * Project files the editor opens that carry no extension.
 *
 * `TEXT_FILE_EXTENSIONS` keys them by a lowercased NAME (`dockerfile`,
 * `makefile`), which never matches a basename with no dot — the reason this
 * table exists rather than being folded into that one.
 */
const NAMED_FILES: Record<string, true> = {
  dockerfile: true,
  makefile: true,
  procfile: true,
  justfile: true,
  brewfile: true,
  gemfile: true,
  rakefile: true,
  license: true,
  licence: true,
  notice: true,
  codeowners: true,
  readme: true,
};

/**
 * Dot-files and lockfiles whose suffix is not in `TEXT_FILE_EXTENSIONS` but is
 * still ordinary text the editor reads.
 */
const EXTRA_EXTENSIONS: Record<string, true> = {
  lock: true,
  prettierrc: true,
  eslintrc: true,
  babelrc: true,
  nvmrc: true,
  npmrc: true,
  gitattributes: true,
  gitmodules: true,
  dockerignore: true,
  editorsettings: true,
};

/** An absolute path (POSIX, Windows drive or home) is never workspace-relative. */
const ABSOLUTE_RE = /^(?:[/\\]|[A-Za-z]:[\\/]|~[/\\])/;

/**
 * Glob, shell, markup and query characters. A path on disk can legally hold
 * some of them, but the inline-code spelling of one never does — and rejecting
 * the whole set is what keeps `*.tsx`, `--flag=value`, `a?b` and `foo|bar` out.
 */
const FORBIDDEN_RE = /[[\]{}*?<>|"'`$=,;]/;

/** `path:42`, `path:42-50`, `path:42:7` — omp's read selector without the mode. */
const COLON_LINE_RE = /^(.+?):(\d+)(?:[-,:]\d+)?$/;

/** GitHub's `path#L42` / `path#L42-L50`. */
const HASH_LINE_RE = /^(.+?)#L(\d+)(?:-L?\d+)?$/i;

/** Whether `name` is a file the editor can open, by extension or by name. */
function isOpenableName(name: string): boolean {
  const lower = name.toLowerCase();
  if (NAMED_FILES[lower]) return true;
  const dot = lower.lastIndexOf('.');
  if (dot === -1) return false;
  // A dot-file's "extension" is everything after the leading dot.
  const ext = dot === 0 ? lower.slice(1) : lower.slice(dot + 1);
  return TEXT_FILE_EXTENSIONS[ext] === true
    || VIEWER_EXTENSIONS[ext] === true
    || EXTRA_EXTENSIONS[ext] === true;
}

/** The path alone, and the line when the spelling carries one. */
function splitLineSuffix(text: string): InlineFileReference {
  const hash = HASH_LINE_RE.exec(text);
  if (hash) return { path: hash[1], line: Number(hash[2]) };
  const colon = COLON_LINE_RE.exec(text);
  if (colon) return { path: colon[1], line: Number(colon[2]) };
  return { path: text };
}

/**
 * The file this inline-code text names, or null when it is ordinary code.
 *
 * Pure and synchronous: it runs once per inline code span on every render of a
 * streaming transcript, so it must not touch the network or the DOM.
 */
export function inlineFileReference(rawText: string): InlineFileReference | null {
  const text = rawText.trim();
  if (!text || /\s/.test(text)) return null;
  // A shell flag is not a path, even when it ends in `.ts`.
  if (text.startsWith('-')) return null;
  if (ABSOLUTE_RE.test(text)) return null;
  if (FORBIDDEN_RE.test(text)) return null;

  const reference = splitLineSuffix(text);
  // A leftover scheme, drive letter or read-mode chunk (`:raw`) is not a path;
  // `#` that survived the `#L` rule is an anchor, not part of a filename.
  if (reference.path.includes(':') || reference.path.includes('\\') || reference.path.includes('#')) {
    return null;
  }

  const path = reference.path.startsWith('./') ? reference.path.slice(2) : reference.path;
  if (!path || path.endsWith('/')) return null;
  const segments = path.split('/');
  // Empty segments catch `a//b`; `.`/`..` would escape the workspace scope the
  // open event resolves against.
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null;
  if (!isOpenableName(segments[segments.length - 1])) return null;

  return reference.line !== undefined ? { path, line: reference.line } : { path };
}

/** `&amp;` and friends are how a markdown URL reaches the HTML attribute. */
function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Attribute values are injected as HTML, so `&` and `"` must be entities. */
function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/** Exactly the chip `marked.ts` emits for inline code; a fence has a language class. */
const INLINE_CODE_RE = /<code class="inline-code">([^<]*)<\/code>/g;

/**
 * Put the file identity on every inline code span that names one.
 *
 * Runs after sanitization (see `useRenderedMarkdown`), so the attributes never
 * pass through DOMPurify. The regex is safe for the same reason the local-image
 * marker is: the renderer escapes `<` inside a code span, so a fenced block
 * that PRINTS this markup arrives as `&lt;code …` and cannot match.
 */
export function markInlineFilePaths(html: string): string {
  if (!html.includes('class="inline-code"')) return html;
  return html.replace(INLINE_CODE_RE, (match, escaped: string) => {
    const reference = inlineFileReference(decodeEntities(escaped));
    if (!reference) return match;
    const path = escapeAttribute(reference.path);
    const title = `Open ${path} in the editor`;
    const attributes = [
      `${INLINE_FILE_ATTRIBUTE}="${path}"`,
      ...(reference.line !== undefined ? [`${INLINE_FILE_LINE_ATTRIBUTE}="${reference.line}"`] : []),
      'role="button"',
      'tabindex="0"',
      `title="${title}"`,
      `aria-label="${title}"`,
    ];
    return `<code class="inline-code" ${attributes.join(' ')}>${escaped}</code>`;
  });
}
