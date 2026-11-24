/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Pasting a FILE into the composer: attach it, write its filename into the
 * draft, and keep the chip's name tied to that text.
 *
 * The reasons this is a hook rather than three lines in the paste handler:
 *
 * - The filenames must be written in the SAME tick as the paste, because that
 *   is when the caret still sits where the user aimed it. The attachment hook
 *   reports the entries it created synchronously (before their bytes are read)
 *   for exactly this.
 * - A filename in the draft is only text the user can edit, so the chip's name
 *   follows it: typing inside the name renames the attachment, deleting the
 *   whole name detaches it. The range each name occupies is tracked here and
 *   remapped through every draft change, not re-derived by searching for the
 *   text — two pasted `a.md` would otherwise fight over one chip.
 * - A rename must not erase what classified the file. `name` becomes the
 *   draft text; `sourceName` freezes the file's own name, so a text attachment
 *   renamed away from its extension is still inlined at send time.
 */

import { useCallback, useEffect, useRef } from 'preact/hooks';
import type { ClipboardEvent, RefObject, SetStateAction } from 'preact/compat';
import type { Attachment } from '@/shared/types';
import { attachmentName, attachmentSourceName } from '@/shared/lib/chat/attachments';
import {
  insertAttachmentLabels,
  remapAttachmentLabels,
  type DraftLabel,
} from '@/shared/lib/chat/composer/attachment-labels';
import { primeFileReads } from '@/client/hooks/chat/composer/file-reads';
import type { PrimedReads } from '@/client/hooks/chat/composer/file-reads';

export interface UsePastedAttachmentsOptions {
  value: string;
  onChange: (value: string) => void;
  attachments: Attachment[];
  setAttachments: (updater: SetStateAction<Attachment[]>) => void;
  /** Attach a batch and report the entries it created, before their reads. */
  acceptFiles: (
    files: File[],
    incomplete?: boolean,
    references?: string[],
    primed?: PrimedReads,
    onAttached?: (created: Attachment[]) => void,
  ) => void;
  removeAttachment: (id: string) => void;
  /** The draft element, so the caret lands after the inserted filenames. */
  textareaRef: RefObject<HTMLTextAreaElement>;
}

export interface ComposerPastedAttachments {
  /** `onChange`, with every tracked filename re-read from the new draft. */
  onChange: (value: string) => void;
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  /** Chip removal, which also stops tracking that filename's token. */
  onRemoveAttachment: (id: string) => void;
}

export function usePastedAttachments({
  value,
  onChange: onDraftChange,
  attachments,
  setAttachments,
  acceptFiles,
  removeAttachment,
  textareaRef,
}: UsePastedAttachmentsOptions): ComposerPastedAttachments {
  const labels = useRef(new Map<string, DraftLabel>());
  // The draft as this hook last saw it. Diffing against the RENDERED `value`
  // would miss a change the parent has not committed yet (a paste followed by a
  // keystroke in the same frame), and would diff from a stale text after the
  // parent resets the draft itself (a send).
  const draft = useRef(value);
  useEffect(() => { draft.current = value; }, [value]);

  // Drop tracking for attachments that left the composer (a chip removed, a
  // send cleared the draft). The draft text is the user's prose and stays.
  useEffect(() => {
    if (labels.current.size === 0) return;
    const live = new Set(attachments.map((att) => att.id));
    for (const id of [...labels.current.keys()]) if (!live.has(id)) labels.current.delete(id);
  }, [attachments]);

  /**
   * Move every tracked token through one draft change and write the new names
   * back. `inserted` carries the ranges of a paste that is landing now: they
   * are already in the NEXT draft's coordinates, so they are adopted after the
   * remap instead of being mapped through it.
   */
  const reconcile = useCallback((
    previous: string,
    next: string,
    inserted?: Map<string, DraftLabel>,
  ) => {
    const remapped = remapAttachmentLabels(previous, next, labels.current);
    const byId = new Map(attachments.map((att) => [att.id, att]));
    const gone: string[] = [];
    const renames = new Map<string, string>();
    for (const [id, range] of remapped) {
      if (!range) {
        labels.current.delete(id);
        gone.push(id);
        continue;
      }
      labels.current.set(id, { ...range });
      const text = next.slice(range.start, range.end);
      const att = byId.get(id);
      if (att && text !== attachmentName(att)) renames.set(id, text);
    }
    if (inserted) for (const [id, range] of inserted) labels.current.set(id, range);

    // Detach through the pipeline, which also releases the chip's preview URL.
    for (const id of gone) removeAttachment(id);
    if (renames.size === 0) return;
    setAttachments((list) => list.map((att) => {
      const name = renames.get(att.id);
      if (name === undefined) return att;
      // Frozen at the first rename: the extension that classified this file
      // must survive every later edit of the draft text.
      return { ...att, name, sourceName: attachmentSourceName(att) };
    }));
  }, [attachments, removeAttachment, setAttachments]);

  const onChange = useCallback((next: string) => {
    const previous = draft.current;
    draft.current = next;
    reconcile(previous, next);
    onDraftChange(next);
  }, [onDraftChange, reconcile]);

  const onPaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboard = event.clipboardData;
    if (!clipboard || clipboard.files.length === 0) return;
    event.preventDefault();
    const files = Array.from(clipboard.files);
    const field = event.currentTarget;
    const previous = draft.current;
    // The caret is read NOW: after the reads below the user may have typed.
    const start = field.selectionStart ?? previous.length;
    const end = field.selectionEnd ?? start;
    // The clipboard's file permission is released when this handler returns,
    // so the reads are started here, in its tick.
    acceptFiles(files, false, [], primeFileReads(files), (created) => {
      const named = created.filter((att) => attachmentName(att).trim().length > 0);
      if (named.length === 0) return;
      const insertion = insertAttachmentLabels(previous, { start, end }, named.map(attachmentName));
      const ranges = new Map<string, DraftLabel>();
      named.forEach((att, index) => {
        const range = insertion.labels[index];
        if (range) ranges.set(att.id, range);
      });
      draft.current = insertion.value;
      reconcile(previous, insertion.value, ranges);
      onDraftChange(insertion.value);
      // The controlled value lands on the next render; place the caret after it.
      const placeCaret = () => textareaRef.current?.setSelectionRange(insertion.caret, insertion.caret);
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(placeCaret);
      else setTimeout(placeCaret, 0);
    });
  }, [acceptFiles, onDraftChange, reconcile, textareaRef]);

  const onRemoveAttachment = useCallback((id: string) => {
    labels.current.delete(id);
    removeAttachment(id);
  }, [removeAttachment]);

  return { onChange, onPaste, onRemoveAttachment };
}
