/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Syntax-highlighted markup that never blocks the interaction that asked for it.
 *
 * A tool card renders its code the moment it is expanded, and the tokenizer used
 * to run inside that render: measured on a throttled phone (4× CPU), a `read`
 * card's expand was a 220–300 ms long task of which ~75% was the Shiki grammar
 * engine, and at 20× the same card blocked for 730–1.484 ms. The card was on
 * screen the whole time — it just could not paint until the last line had been
 * tokenized.
 *
 * So the first render draws the text, escaped and correct, and the tokenized
 * markup replaces it once the main thread is free (`scheduleIdle`). The two
 * carry the same characters, so the swap costs colour and no layout.
 *
 * Three properties make that honest:
 *
 * - **A cached block renders highlighted on the FIRST paint.** `highlight-memo`
 *   is checked during render, so reopening a card the reader already opened —
 *   the common case while paging a transcript — has no plain-text frame at all.
 * - **A stale block is never shown.** The value is tagged with the input it was
 *   computed from; a filter keystroke in the search panel therefore shows the
 *   new text, never the previous query's markup.
 * - **Nothing is computed for empty input.** Call sites that gate a branch pass
 *   `''`, which is how `Edit` stops tokenizing the two panels it is not drawing.
 */

import { useEffect, useMemo, useState } from 'preact/hooks';
import { escapeCode } from '@/shared/lib/code/highlighter';
import {
  cachedHighlightBlock,
  cachedHighlightBlockLines,
  highlightBlock,
  highlightBlockLines,
} from '@/shared/lib/code/highlight-memo';
import { scheduleIdle } from '@/shared/lib/code/idle';
import { useSyntaxReady } from '@/client/hooks/ui/syntax-ready';

interface Deferred<T> {
  /** Identity of the input; a value computed for another input is not shown. */
  key: object;
  hasContent: boolean;
  cached: T | undefined;
  plain: T;
  compute: () => T;
}

function useDeferred<T>(spec: Deferred<T>): T {
  // A grammar arriving is what turns a plain fallback into a real highlight, so
  // the effect re-runs on it even though the input did not move.
  const syntaxReady = useSyntaxReady();
  const [state, setState] = useState<{ key: object; value: T }>(() => ({
    key: spec.key,
    value: spec.cached ?? spec.plain,
  }));

  /** Adopt a value only when it is a change, so a cached block does not cost an
   *  extra render on every mount. */
  const adopt = (key: object, value: T): void => {
    setState((previous) => (previous.key === key && previous.value === value ? previous : { key, value }));
  };

  useEffect(() => {
    if (!spec.hasContent) {
      adopt(spec.key, spec.plain);
      return;
    }
    if (spec.cached !== undefined) {
      adopt(spec.key, spec.cached);
      return;
    }
    let cancelled = false;
    const cancel = scheduleIdle(() => {
      if (cancelled) return;
      let value: T;
      try {
        value = spec.compute();
      } catch {
        // A grammar that cannot tokenize this input leaves the escaped text,
        // which is what the first paint already drew.
        value = spec.plain;
      }
      if (!cancelled) adopt(spec.key, value);
    });
    return () => {
      cancelled = true;
      cancel();
    };
    // `spec` is rebuilt every render; its KEY (the input) and the grammar's
    // readiness are what decide the work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.key, syntaxReady]);

  if (state.key === spec.key) return state.value;
  return spec.cached ?? spec.plain;
}

/** Tokenized markup for one block, deferred off the render that asked for it. */
export function useDeferredHighlight(code: string, language: string): string {
  const key = useMemo(() => ({ code, language }), [code, language]);
  const plain = useMemo(() => escapeCode(code), [code]);
  return useDeferred<string>({
    key,
    hasContent: Boolean(code),
    cached: code ? cachedHighlightBlock(code, language) : undefined,
    plain,
    compute: () => highlightBlock(code, language),
  });
}

/** Tokenized markup per line, deferred the same way. */
export function useDeferredHighlightLines(code: string, language: string): string[] {
  const key = useMemo(() => ({ code, language }), [code, language]);
  const plain = useMemo(
    () => (code ? code.split('\n').map(escapeCode) : []),
    [code],
  );
  return useDeferred<string[]>({
    key,
    hasContent: Boolean(code),
    cached: code ? cachedHighlightBlockLines(code, language) : undefined,
    plain,
    compute: () => highlightBlockLines(code, language),
  });
}
