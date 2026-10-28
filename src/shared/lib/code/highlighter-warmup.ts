/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Pay the tokenizer's start-up cost before the reader taps anything.
 *
 * `EAGER_LANGS` are loaded in the background at boot, but loading a grammar is
 * not compiling it: the grammar's regexes are built and JIT-ed on the first
 * tokenize, which is why the FIRST expand of a card in a given language measured
 * 220–300 ms at 4× CPU while the same card re-expanded in 33 ms. That first
 * expand is the one a reader actually experiences — a transcript opens with
 * `read` and `bash` cards.
 *
 * So each eager grammar is tokenized once, on a tiny sample, while the main
 * thread is idle. The sample's markup is discarded; the work being paid for is
 * the compile behind it. One language per idle slice, so a slow grammar cannot
 * become the long task this exists to prevent — and a grammar that has not
 * landed yet is retried rather than skipped, because tokenizing before it
 * arrives compiles nothing.
 *
 * Booted from `main.tsx` rather than from `highlighter.ts`: the warm-up needs
 * the memo, which needs the highlighter, and an import in the other direction
 * would close that cycle.
 */

import { isLanguageReady } from '@/shared/lib/code/highlighter-lazy';
import { highlightBlock } from '@/shared/lib/code/highlight-memo';
import { scheduleIdle } from '@/shared/lib/code/idle';
import { EAGER_LANGS } from '@/shared/lib/code/shiki-langs';

/**
 * A few lines that make the grammar walk its own rule set: a keyword, a string,
 * a comment, a call and a block. The exact text does not matter — the compile
 * does — so these are deliberately tiny.
 */
const SAMPLES: Record<string, string> = {
  typescript: '// warm\nconst value: number = 1;\nfunction read(input: string) {\n  return input;\n}\n',
  tsx: '// warm\nexport const View = ({ title }: { title: string }) => (\n  <div className="row">{title}</div>\n);\n',
  javascript: '// warm\nconst value = 1;\nfunction read(input) {\n  return input;\n}\n',
  jsx: '// warm\nexport const View = ({ title }) => (\n  <div className="row">{title}</div>\n);\n',
  json: '{\n  "name": "warm",\n  "items": [1, 2, 3],\n  "ok": true\n}\n',
  bash: '#!/bin/sh\n# warm\nset -e\nfor file in *.ts; do\n  echo "$file"\ndone\n',
  python: '# warm\ndef read(value: str) -> str:\n    return value.strip()\n',
  markdown: '# warm\n\nA paragraph with **bold** text and a `code` span.\n\n- item\n',
  yaml: 'name: warm\nitems:\n  - one\n  - two\nenabled: true\n',
  diff: '--- a/file.ts\n+++ b/file.ts\n@@ -1,2 +1,2 @@\n-old line\n+new line\n context\n',
};

const DEFAULT_SAMPLE = '// warm\nconst value = 1;\nfunction read(input) {\n  return input;\n}\n';

/** How many idle slices a not-yet-loaded grammar is retried for. */
const MAX_WAIT_SLICES = 120;

export interface WarmOptions {
  /** Languages to warm; defaults to the eager set. */
  languages?: readonly string[];
  /** The tokenizer; injected so a test can observe the schedule. */
  highlight?: (code: string, language: string) => void;
  /** Grammar readiness; injected for the same reason. */
  ready?: (language: string) => boolean;
  /** The idle scheduler; injected so a test can drive it synchronously. */
  schedule?: (run: () => void) => () => void;
}

let started = false;

/**
 * Warm every eager grammar once per page load, one per idle slice.
 *
 * Idempotent: a second call is a no-op, so a re-evaluated client entry cannot
 * re-tokenize every language.
 */
export function warmSyntaxTokenizers(options: WarmOptions = {}): void {
  if (started) return;
  if (typeof window === 'undefined') return;
  started = true;

  const languages = options.languages ?? EAGER_LANGS;
  const highlight = options.highlight ?? ((code: string, language: string) => { highlightBlock(code, language); });
  const ready = options.ready ?? isLanguageReady;
  const schedule = options.schedule ?? ((run: () => void) => scheduleIdle(run));

  const queue = [...languages];
  let waiting = 0;
  const step = () => {
    const language = queue.shift();
    if (language === undefined) return;
    if (!ready(language)) {
      // The grammar is still being fetched. Warming it now would compile
      // nothing and the sample would not even be cacheable.
      if (++waiting <= MAX_WAIT_SLICES) queue.push(language);
      schedule(step);
      return;
    }
    waiting = 0;
    try {
      highlight(SAMPLES[language] ?? DEFAULT_SAMPLE, language);
    } catch {
      // A grammar that cannot warm is not an error: the first real highlight
      // falls back to escaped text and retries when the grammar lands.
    }
    schedule(step);
  };
  schedule(step);
}

/** Test/restart seam: forget that the warm-up already ran. */
export function resetTokenizerWarmup(): void {
  started = false;
}
