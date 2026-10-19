/**
 * Path helpers shared by the Files panel and every surface that opens a file.
 *
 * `/api/fs/dir` emits every entry as a path relative to the listing's base
 * directory — the workspace root, or the selected nested repo — and reports
 * that base back as `root`. Copy Path rebuilds the absolute path from those
 * two halves; a relative path on its own is not resolvable outside the panel
 * (the client-side `rootPath` may be `~`-relative, rejected by the server, or
 * absent entirely in mock mode).
 *
 * `buildFsRawUrl` is the byte-stream counterpart of that same scoping: it is
 * what an image tab points its `<img>` at, so the file it names is the file
 * the tab names, nested repo included.
 */

/**
 * URL of one file's raw bytes through `/api/fs/raw`, carrying the same scope
 * (`root`, nested `repo`) as `/api/fs/read` so an image opened from a nested
 * repo resolves to the file the tab names. `repo: '.'` is omitted: the server
 * treats an absent repo as the scoped root.
 */
export function buildFsRawUrl(file: { path: string; root?: string; repo?: string }): string {
  const params = new URLSearchParams({ path: file.path });
  if (file.root) params.set('root', file.root);
  if (file.repo && file.repo !== '.') params.set('repo', file.repo);
  return `/api/fs/raw?${params.toString()}`;
}

/**
 * True for an omp internal URL (`proc://`, `xd://`, `agent://`, `skill://`, …)
 * rather than a path on disk.
 *
 * The File panel's lazy read points `/api/fs/read` at whatever path a `read`
 * named, and a virtual URL names no file: `read proc://kabmo-dev` sent
 * `/api/fs/read?path=proc%3A%2F%2Fkabmo-dev`, the route refused it, and
 * the panel printed `// Loaded file: proc://kabmo-dev` as if that were the
 * file's contents. Only a path with a scheme and no local meaning is excluded —
 * a Windows drive letter (`C:\x`) is a single colon and stays a path.
 */
export function isVirtualPath(path: string | undefined): boolean {
  return typeof path === 'string' && /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(path);
}

/**
 * omp's read-tool selector grammar, mirroring `splitPathAndSel` in
 * `@oh-my-pi/pi-tui/tools/read.ts`: a line range (or a comma list of them), a
 * tail count, or a display mode — alone or compounded (`path:1-50:raw`,
 * `path:raw:1-50`, `path:raw:-60`).
 *
 * The `N-`/`N..` open-ended and `N+K` forms are part of the grammar, and a
 * chunk is only a selector when it ENDS in a digit, `.` or `-` — that trailing
 * rule is what rejects an incomplete `N+`, exactly as omp's own lookbehind does.
 */
const READ_MODE_CHUNK_RE = /^(?:raw|conflicts|img)$/i;
const READ_RANGE_CHUNK_RE = new RegExp(
  String.raw`^(?:-\d+|L?\d+(?:(?:\.\.|[-+])L?\d*)?(?:,L?\d+(?:(?:\.\.|[-+])L?\d*)?)*)$`,
  'i',
);

/**
 * Strip the trailing read-tool selector from a path, so the path names the FILE
 * and nothing else.
 *
 * `read` accepts a selector on the path itself (`Read.tsx:205-215:raw`) and the
 * Kabmo carried the whole string around as if it were the file name: the
 * language detector read the extension as `tsx:205-215:raw`, answered `text`,
 * and the code surface rendered unhighlighted (measured on a real session
 * store: 9517 of 18128 read paths carry a selector, and 1268 of those — every
 * `:raw`, `:img` and comma-list — were missed by the previous `:N-M`-only
 * strip). `/api/fs/read` and `/api/fs/raw` want the bare path for the same
 * reason: neither route parses a selector, and the image sniff read
 * `x.png:raw` as an unknown extension.
 *
 * A URL is returned untouched. Its colon can be a port — `http://host:8080/x`
 * would otherwise lose `:8080` to the line-range rule — and no fs route ever
 * receives one.
 *
 * A chunk is only peeled while it matches the selector grammar AND ends in a
 * digit, `.` or `-` (omp's own trailing lookbehind: it is what rejects the
 * incomplete `N+`), so a file legally named `a:1-50` keeps its name — the same
 * conservatism omp's splitter applies.
 */
export function stripReadSelector(path: string): string {
  if (!path || isVirtualPath(path)) return path;
  const cut = path.search(/[?#]/);
  let result = cut === -1 ? path : path.slice(0, cut);
  for (;;) {
    const colon = result.lastIndexOf(':');
    if (colon <= 0) break;
    const chunk = result.slice(colon + 1);
    const isMode = READ_MODE_CHUNK_RE.test(chunk);
    // A numeric chunk must END in a digit, `.` or `-`: omp's own trailing
    // lookbehind, and what rejects the incomplete `N+` (`path:50+`).
    const isRange = READ_RANGE_CHUNK_RE.test(chunk) && /[\d.-]$/.test(chunk);
    if (!isMode && !isRange) break;
    result = result.slice(0, colon);
  }
  return result;
}

export function toAbsolutePath(baseDir: string | null | undefined, relPath: string): string {
  // `/`- and `./`-prefixed raws are stripped; a dot-file name (`.env`) is not a prefix.
  const rel = relPath.replace(/^(?:\.?[/\\])+/, '').replace(/[/\\]+$/, '');
  const base = (baseDir ?? '').replace(/[/\\]+$/, '');
  if (!base) return rel;
  if (!rel) return base;
  // Join with the base's own separator: `C:\proj` + `src` → `C:\proj\src`.
  return `${base}${base.includes('\\') && !base.includes('/') ? '\\' : '/'}${rel}`;
}
