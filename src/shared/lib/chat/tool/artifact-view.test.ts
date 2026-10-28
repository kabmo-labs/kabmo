/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which renderer a spilled artifact gets.
 *
 * The reader used to show every artifact as a `<pre>`, so this is the decision
 * that was missing. Each case below is a shape measured on a real install
 * (1,684 artifacts): a `bash` whose stdout IS a diff (184 files), an `eval`
 * that returned JSON (119), a `read` of a URL that answered markdown (44), and
 * a numbered excerpt (11). The ORDER matters too, and is pinned here: a unified
 * diff opens `--- a/x`, which is also a markdown bullet, so a diff classified
 * after markdown renders as prose.
 */

import { describe, expect, test } from 'bun:test';
import { artifactViewKind, looksLikeDiff } from '@/shared/lib/chat/tool/artifact-view';

describe('artifactViewKind', () => {
  test('reads a unified diff as a diff, not as markdown bullets', () => {
    const diff = ['diff --git a/x.ts b/x.ts', '--- a/x.ts', '+++ b/x.ts', '@@ -1 +1 @@', '-a', '+b'].join('\n');
    expect(artifactViewKind(diff)).toBe('diff');
  });

  test("reads omp's excerpt diff as a diff", () => {
    expect(artifactViewKind(['-43|  return new Promise(…)', '+44|  return x;'].join('\n'))).toBe('diff');
  });

  test('reads a JSON body as json, however large', () => {
    // Over `detectOutputFormat`'s 100 kB cap on purpose: a large eval dump is
    // the case this reader exists for, so the cap must not decide here.
    const big = JSON.stringify({ rows: Array.from({ length: 6000 }, (_, i) => ({ i, pad: 'x'.repeat(20) })) });
    expect(big.length).toBeGreaterThan(100_000);
    expect(artifactViewKind(big)).toBe('json');
  });

  test('reads a numbered excerpt as code, in both of omp\'s spellings', () => {
    expect(artifactViewKind(['1:import x', '2:const y = 1'].join('\n'))).toBe('code');
    expect(artifactViewKind(['15623|- `/api/packages`', '15624|- `/api/x`'].join('\n'))).toBe('code');
  });

  test('reads a markdown document as markdown', () => {
    expect(artifactViewKind('# Fullstack dev server\n\n> Build fullstack apps with Bun')).toBe('markdown');
  });

  test('leaves a plain log as text', () => {
    expect(artifactViewKind('error: rpc down\n    at /a/b.ts:12:3')).toBe('text');
  });

  test('treats an empty payload as text rather than as JSON', () => {
    expect(artifactViewKind('   ')).toBe('text');
  });
});

describe('looksLikeDiff', () => {
  test('ignores a log that merely prints @@ past its head', () => {
    const log = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n') + '\n@@ not a diff';
    expect(looksLikeDiff(log)).toBe(false);
  });

  test('accepts a unified diff whose headers are its first lines', () => {
    expect(looksLikeDiff('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b')).toBe(true);
  });
});
