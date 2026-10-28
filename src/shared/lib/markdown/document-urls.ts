/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Resolve the relative references of a markdown *document* (an opened file's
 * preview) to the workspace files they actually name.
 *
 * A previewed file is not a chat message: `![](docs/hero.png)` means the image
 * on disk beside the document, and `[Architecture](AGENTS.md)` means that file.
 * Neither resolves on its own — the preview is an app route, so a relative URL
 * is requested from the server's own origin (`/docs/hero.png` → 404, and a
 * click would navigate the console away from itself). Each one is rewritten to
 * the workspace file it points at: images through `/api/fs/raw` (real bytes,
 * real content-type) and links through the same URL plus the resolved path in
 * `data-file-path`, which the panel turns back into an editor tab.
 *
 * Only plain relative references are touched. Anything with a scheme
 * (`https:`, `mailto:`, `data:`), a protocol-relative `//host`, or a bare
 * `#anchor` is the document's own business and is left exactly as written.
 */

import { buildFsRawUrl } from '@/shared/lib/fs/paths';

/**
 * Where the document lives. `path` is relative to the picked scope exactly the
 * way `/api/fs/raw` and the file panel read it: relative to `repo` when one is
 * picked, otherwise to `root`.
 */
export interface DocumentScope {
  path: string;
  root?: string;
  repo?: string;
}

export interface ResolvedDocumentReference {
  /** Scope-relative path of the referenced file — what an editor tab opens. */
  path: string;
  /** Raw-bytes URL of the same file, for an `<img src>` or a middle-click. */
  url: string;
}

/** A scheme (`https:`), protocol-relative host, fragment, or empty ref. */
const ABSOLUTE_REFERENCE_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|$)/i;

/** Collapse `.`/`..` segments; ascending above the scope root is dropped. */
function normalizeSegments(segments: string[]): string {
  const out: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join('/');
}

/** `%20`-style escapes are how a markdown link writes a space. */
function decodeReference(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Resolve one reference written inside `scope`'s document, or null when it is
 * not a relative file reference (leave those untouched).
 */
export function resolveDocumentReference(
  reference: string,
  scope: DocumentScope,
): ResolvedDocumentReference | null {
  const raw = reference.trim();
  if (ABSOLUTE_REFERENCE_RE.test(raw)) return null;

  // `?v=1` and `#section` address the preview, not the file on disk.
  const withoutQuery = raw.split(/[?#]/)[0];
  const decoded = decodeReference(withoutQuery);
  if (!decoded) return null;

  // A leading slash is root-relative (GitHub's repo-root rule), and the scope
  // frame already IS that root, so it resolves without the document's folder.
  const rootRelative = /^[/\\]/.test(decoded);
  const documentDir = scope.path.replace(/\\/g, '/').split('/').slice(0, -1);
  const segments = decoded.split(/[\\/]+/);
  const path = normalizeSegments(rootRelative ? segments : [...documentDir, ...segments]);
  if (!path) return null;

  return { path, url: buildFsRawUrl({ path, root: scope.root, repo: scope.repo }) };
}

/** Attribute values are injected as HTML, so `&` and `"` must be entities. */
function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/**
 * Rewrite the relative `src`/`href` attributes of rendered document HTML.
 * Fenced code is already escaped by the renderer, so a literal `src="` inside
 * a code block cannot be mistaken for an attribute.
 */
export function rewriteDocumentReferences(html: string, scope: DocumentScope): string {
  return html.replace(/(\s(?:src|href))="([^"]*)"/g, (match, attribute: string, value: string) => {
    const resolved = resolveDocumentReference(value, scope);
    if (!resolved) return match;
    const url = ` ${attribute.trim()}="${escapeAttribute(resolved.url)}"`;
    // The resolved path rides along on links only: it is what a click opens as
    // a tab, and a mid-click still has the raw URL to fall back to.
    return attribute.trim() === 'href'
      ? `${url} data-file-path="${escapeAttribute(resolved.path)}"`
      : url;
  });
}
