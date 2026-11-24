/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The filename text a paste puts into the draft, and how that text keeps
 * tracking the attachment it names.
 *
 * A pasted file arrives twice: as an attachment chip, and as the filename the
 * user reads in their own sentence. The two must not drift, so the chip's name
 * is the text at a tracked range of the draft — editing `notes.md` in the
 * sentence renames the chip, deleting the whole token detaches it.
 *
 * Ranges are remapped from ONE edit window per change: the longest common
 * prefix and suffix of the previous and next drafts. That is exactly what a
 * keystroke, a selection replace, a completion insert and an undo each are, and
 * it needs no diffing of the middle. Two boundary rules are load-bearing:
 *
 * - At a token's start an insertion pushes the token right whole; at its end it
 *   extends the name only when the inserted text is one unbroken run. Typing
 *   `x` after `notes.md` is a rename; typing ` please` is prose.
 * - A range the edit leaves empty is a deleted token (`null`), never a
 *   zero-width label. A name the edit WROTE OVER must also still be one word:
 *   the replacement may be the rest of a rewritten sentence, and a chip named
 *   after prose would send a file the model cannot identify.
 */

/** A token's span in the draft, half-open `[start, end)`. */
export interface DraftLabel {
  start: number;
  end: number;
}

export interface LabelInsertion {
  /** The draft with the filenames written at the caret. */
  value: string;
  /** Where the caret belongs once the inserted text is in place. */
  caret: number;
  /** One range per inserted name, in the same order, already in `value` space. */
  labels: DraftLabel[];
}

/**
 * Write `names` into the draft at the caret, replacing any selection.
 *
 * Nameless files are skipped: a clipboard image can arrive with an empty name,
 * and a zero-width token would look like the paste did nothing. Names are
 * trimmed for the same reason — the range must cover exactly the visible text.
 */
export function insertAttachmentLabels(
  value: string,
  selection: { start: number; end: number },
  names: readonly string[],
): LabelInsertion {
  const from = Math.max(0, Math.min(selection.start, value.length));
  const to = Math.max(from, Math.min(selection.end, value.length));
  const kept = names.map((name) => name.trim()).filter((name) => name.length > 0);
  if (kept.length === 0) return { value, caret: to, labels: [] };

  const text = kept.join(' ');
  const labels: DraftLabel[] = [];
  let offset = from;
  for (const name of kept) {
    labels.push({ start: offset, end: offset + name.length });
    offset += name.length + 1;
  }
  return {
    value: `${value.slice(0, from)}${text}${value.slice(to)}`,
    caret: from + text.length,
    labels,
  };
}

/** The single replaced window between two drafts. */
export interface DraftEdit {
  /** Length of the shared leading text. */
  prefix: number;
  /** End of the replaced text in the PREVIOUS draft. */
  previousEnd: number;
  /** Text written in its place. */
  inserted: string;
}

/** Longest-common-prefix/suffix edit window: what one change replaced. */
export function draftEdit(previous: string, next: string): DraftEdit {
  const limit = Math.min(previous.length, next.length);
  let prefix = 0;
  while (prefix < limit && previous[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < limit - prefix
    && previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    prefix,
    previousEnd: previous.length - suffix,
    inserted: next.slice(prefix, next.length - suffix),
  };
}

/**
 * Re-map every tracked token through one draft change.
 *
 * Returns a range in `next` coordinates, or `null` when the token no longer
 * names a file: the change emptied it, or filled it with prose. A token outside
 * the edit window is shifted by the change's length delta, never re-derived
 * from its text, so one that merely moved cannot be mistaken for a rename.
 */
export function remapAttachmentLabels(
  previous: string,
  next: string,
  labels: ReadonlyMap<string, DraftLabel>,
): Map<string, DraftLabel | null> {
  const edit = draftEdit(previous, next);
  const delta = next.length - previous.length;
  // A pure insertion has no replaced text, and its point is the ONLY place
  // where the two boundaries disagree: text written at a token's start belongs
  // before it, text written at its end belongs after it.
  const insertion = edit.previousEnd === edit.prefix;
  const mapStart = (position: number) => {
    if (insertion) return position >= edit.prefix ? position + delta : position;
    if (position <= edit.prefix) return position;
    if (position >= edit.previousEnd) return position + delta;
    // Strictly inside the replaced window: the token began in text that is
    // gone, so it now begins where the replacement begins.
    return edit.prefix;
  };
  const mapEnd = (position: number) => {
    if (insertion) {
      if (position > edit.prefix) return position + delta;
      // Text written exactly at the token's end continues the NAME when it is
      // one unbroken run (`notes.md` + `x`), and starts prose the moment it
      // carries a space (`notes.md` + ` please`) — a chip renamed to the rest
      // of the sentence is what this boundary exists to prevent.
      const continues = edit.inserted.length > 0 && !/\s/.test(edit.inserted);
      return position === edit.prefix && continues ? position + delta : position;
    }
    if (position < edit.prefix) return position;
    if (position >= edit.previousEnd) return position + delta;
    // Inside the replaced window: the token's tail was rewritten, so the
    // token now runs to the end of the replacement. Mapping it to the START
    // of the window is what detached the second of two identical filenames
    // when the user edited only that one.
    return edit.prefix + edit.inserted.length;
  };

  const replaced = edit.previousEnd > edit.prefix;
  const remapped = new Map<string, DraftLabel | null>();
  for (const [id, label] of labels) {
    const start = mapStart(label.start);
    const end = mapEnd(label.end);
    const text = end > start ? next.slice(start, end) : '';
    // A name the edit WROTE OVER is judged as a filename: one unbroken run,
    // because the replacement may be the rest of a rewritten sentence. A name
    // that only moved (or grew from an insertion inside it) keeps whatever text
    // it has — `my notes.md` is a real macOS filename, and whitespace in it must
    // not detach the file on the next keystroke.
    const overwritten = replaced && label.start < edit.previousEnd && label.end > edit.prefix;
    const usable = text.length > 0 && (!overwritten || !/\s/.test(text));
    remapped.set(id, usable ? { start, end } : null);
  }
  return remapped;
}
