/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Writing the parent's `value` into the view — and, more importantly, NOT
 * writing it.
 *
 * The parent re-renders on every keystroke, so an unguarded write would dispatch
 * a full-document replace on each one: a second edit and a fresh undo entry per
 * character.
 *
 * The guard used to be a single comparison against `view.state.doc.toString()`,
 * which is a full stringify of the document — and since the parent re-renders on
 * every keystroke, a large file paid it twice per character. Measured in Bun:
 * 7.2 ms at 20 MB and 13.7 ms at 30 MB; in the browser the knee was visible as
 * 67 ms per keystroke at 30 MB and 83 ms at 40 MB. Both drop by roughly a third
 * once the common case is a reference check.
 *
 * `lastValueRef` is what makes that possible, and its definition is the whole
 * correctness argument: it describes what the DOCUMENT holds — written by the
 * update listener for every change (user or programmatic) and by this function
 * when it writes — never what the parent last asked for. So an external
 * replacement still falls through to the real comparison, while the echo of the
 * parent's own value is rejected in one string comparison.
 */

import type { EditorView } from '@codemirror/view';

export interface MutableRef<T> {
  current: T;
}

export function syncExternal(
  view: EditorView,
  value: string,
  writingRef: MutableRef<boolean>,
  lastValueRef: MutableRef<string>,
): void {
  // The common case: `value` is the string the update listener reported a
  // moment ago, so this costs nothing whatever the document's size.
  if (value === lastValueRef.current) return;
  // A genuinely different string. It may still equal the document (a parent that
  // re-serialized the same text), in which case nothing needs dispatching — and
  // the stringify is affordable here precisely because it is the rare path.
  if (value === view.state.doc.toString()) {
    lastValueRef.current = value;
    return;
  }
  writingRef.current = true;
  try {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    lastValueRef.current = value;
  } finally {
    writingRef.current = false;
  }
}
