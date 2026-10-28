/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The diff parser, over the shapes two hosts actually send.
 *
 * Gitea and Bitbucket answer a diff as text, and both were checked against real
 * output before this parser was written: the header is `diff --git a/x b/x`, a
 * new file carries `new file mode`, a deletion carries `+++ /dev/null`, and a
 * rename carries `rename from`/`rename to` with BOTH paths in the header.
 */

import { describe, expect, test } from 'bun:test';

import { hasHunks, parseUnifiedDiff } from './diff';

const MODIFIED = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 one
-two
+two
+three
 three
`;

const ADDED = `diff --git a/new.ts b/new.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,2 @@
+a
+b
`;

const DELETED = `diff --git a/gone.ts b/gone.ts
deleted file mode 100644
index 4444444..0000000
--- a/gone.ts
+++ /dev/null
@@ -1,1 +0,0 @@
-bye
`;

const RENAMED = `diff --git a/old/name.ts b/new/name.ts
similarity index 92%
rename from old/name.ts
rename to new/name.ts
index 5555555..6666666 100644
--- a/old/name.ts
+++ b/new/name.ts
@@ -1,1 +1,1 @@
-x
+y
`;

describe('parseUnifiedDiff', () => {
  test('a modified file carries its path, counts and hunk text', () => {
    const [file] = parseUnifiedDiff(MODIFIED);
    expect(file.path).toBe('src/a.ts');
    expect(file.status).toBe('modified');
    expect(file.additions).toBe(2);
    expect(file.deletions).toBe(1);
    expect(file.patch).toContain('@@ -1,3 +1,4 @@');
  });

  test('a new file is `added`, and the /dev/null spelling agrees with the mode line', () => {
    const [file] = parseUnifiedDiff(ADDED);
    expect(file.path).toBe('new.ts');
    expect(file.status).toBe('added');
    expect(file.additions).toBe(2);
    expect(file.deletions).toBe(0);
  });

  test('a deleted file is `removed`', () => {
    const [file] = parseUnifiedDiff(DELETED);
    expect(file.path).toBe('gone.ts');
    expect(file.status).toBe('removed');
    expect(file.deletions).toBe(1);
  });

  test('a rename reports the NEW path, because that is what the file is now', () => {
    const [file] = parseUnifiedDiff(RENAMED);
    expect(file.path).toBe('new/name.ts');
    expect(file.status).toBe('renamed');
    expect(file.additions).toBe(1);
    expect(file.deletions).toBe(1);
  });

  test('several files are separated at their own headers', () => {
    const files = parseUnifiedDiff(`${MODIFIED}${ADDED}`);
    expect(files.map((file) => file.path)).toEqual(['src/a.ts', 'new.ts']);
    expect(files.map((file) => file.status)).toEqual(['modified', 'added']);
  });

  test('a diff with no header at all still yields the text', () => {
    const files = parseUnifiedDiff('+only a line\n');
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('(diff)');
    expect(files[0].additions).toBe(1);
  });

  test('an empty diff yields nothing', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
    expect(parseUnifiedDiff('\n\n')).toEqual([]);
  });

  test('a binary change has no hunks, which the caller renders as a name only', () => {
    const [file] = parseUnifiedDiff(`diff --git a/logo.png b/logo.png
index 7777777..8888888 100644
Binary files a/logo.png and b/logo.png differ
`);
    expect(file.path).toBe('logo.png');
    expect(hasHunks(file)).toBe(false);
  });

  test('a hunk is kept whole, including its context lines', () => {
    const [file] = parseUnifiedDiff(MODIFIED);
    expect(file.patch.split('\n')[0]).toBe('@@ -1,3 +1,4 @@');
    expect(file.patch).toContain(' one');
  });
});
