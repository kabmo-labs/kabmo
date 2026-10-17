/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Path resolution for the panel asset route.
 *
 * Split out and unit-tested because the HTTP layer cannot be trusted to
 * exercise it: a request carrying a literal `../` is normalised by the router
 * before this code ever sees it, so a live probe returns the router's 404 and
 * says nothing about whether the guard works. The guard is the thing that
 * matters — it is what stops a manifest whose `entry` was hand-written to
 * escape its plugin directory from becoming a read of any file the server can
 * open.
 */

import { resolve, sep } from 'path';

/**
 * Resolve a request's relative path under a plugin root, or null when it
 * escapes.
 *
 * `resolve` collapses `..` and `.` segments before the comparison, so the test
 * is on the RESOLVED path rather than the written one — a check for the literal
 * substring `..` would miss `a/../../x` and would also refuse a legitimate
 * filename containing two dots. Equality with the root is allowed (a request for
 * the directory itself), and a sibling whose name merely starts with the root's
 * name (`/a/bc` against `/a/b`) is refused by comparing against `root + sep`.
 *
 * The ROOT must be resolved too, and that is not cosmetic: `resolve(root, '.')`
 * collapses a trailing separator and normalises separators, so comparing a
 * resolved target against a raw root fails for any root that does not happen to
 * be spelled exactly the way `resolve` would spell it. On POSIX a plain
 * `/plugins/demo` survives untouched, which is why the bug was invisible there —
 * on Windows every call compared `C:\plugins\demo\x` against `C:\plugins\demo\`
 * and refused it, so every plugin manifest was rejected with "escapes the plugin
 * directory" and no plugin could load at all. Measured: the same call returns
 * null for `index.html` under a Windows root.
 */
export function resolveInsideRoot(root: string, relative: string): string | null {
  const base = resolve(root);
  const target = resolve(base, relative);
  return target === base || target.startsWith(base + sep) ? target : null;
}
