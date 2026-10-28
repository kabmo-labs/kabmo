/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Attachment lifecycle for the composer: accept a batch of files (picker,
 * paste, or OS drop), gate the text ones against the inline budget, hold blob
 * previews, and read the bytes into the attachment.
 *
 * Bytes are read AT ATTACH TIME, not at send time. A `File` handed over by a
 * drop or a paste is a live handle onto the drag data store, and reading it
 * later — after the composer has re-rendered, or after the drag that produced
 * it has ended — is what made a dropped file arrive with an empty body while
 * its chip still rendered. Reading once, here, means every later step (send,
 * queue, retry) works from the persisted copy.
 *
 * Two shapes of "no content yet" have to be told apart, and getting it wrong is
 * what produced a prompt sent with no message at all:
 *
 * - A file from another app arrives as a PROMISE: the entry exists before its
 *   bytes do, so the first read comes back empty. That read is retried.
 * - A genuinely empty file reads empty forever. It is accepted as-is.
 *
 * Only a read that stays empty while the file claims bytes is a failure, and a
 * failure is always reported — never silently omitted.
 */

import { useCallback, useRef } from 'preact/hooks';
import type { SetStateAction } from 'preact/compat';
import type { Attachment } from '@/shared/types';
import { applyTextAttachmentBudget, isTextAttachment, looksLikeTextFile } from '@/shared/lib/chat/attachments';
import { delay, primedPrefix, readAsDataUrl, readFileTextWithRetry } from '@/client/hooks/chat/composer/file-reads';
import type { PrimedReads } from '@/client/hooks/chat/composer/file-reads';

export interface UseComposerAttachmentsOptions {
  /** Current attachments; the text budget is measured against them. */
  attachments: Attachment[];
  setAttachments: (updater: SetStateAction<Attachment[]>) => void;
}

export interface AddFilesOutcome {
  /** How many files were attached. */
  added: number;
  /** Files refused by the inline text budget, for the caller to report. */
  skipped: File[];
  /** Names of files whose contents could not be read, for the caller to report. */
  unreadable: string[];
}

export interface ComposerAttachments {
  /**
   * Reads every accepted file before resolving, so `unreadable` is complete.
   *
   * `primed` carries the reads already started inside the drop handler. Passing
   * it is not an optimization: a dropped `File` can only be read from a read
   * begun while the drop's permission was live, so a batch that arrives without
   * one is the batch that fails. See `file-reads.ts`.
   */
  addFiles: (files: File[], primed?: PrimedReads) => Promise<AddFilesOutcome>;
  removeAttachment: (id: string) => void;
  /**
   * Wait for every in-flight read, then return the attachments AS THEY STAND
   * once those reads have landed.
   *
   * The list is returned rather than left to the caller because a read patches
   * the stored attachment: a caller that captured the array before waiting
   * would still hold the pre-read entry — the one with no content — and send
   * that.
   */
  readyForSend: () => Promise<Attachment[]>;
  /**
   * The attachment list as of right now, read synchronously.
   *
   * A drop registers its files in this hook before the enclosing component has
   * re-rendered, so the component's own `attachments` prop lags by a frame.
   * Deciding a send from that prop lost the attachment entirely: a send clicked
   * immediately after a drop saw an empty list, cleared the composer and
   * dispatched a prompt with nothing in it.
   */
  peek: () => Attachment[];
  /** Empty the composer (state and the hook's own list together). */
  clear: () => void;
}

export function useComposerAttachments({
  attachments,
  setAttachments,
}: UseComposerAttachmentsOptions): ComposerAttachments {
  // In-flight work, so a send can wait for a batch it cannot see the end of.
  const pendingReadsRef = useRef(new Set<Promise<void>>());
  // The authoritative list. It is mirrored into the prop on every render, and
  // updated here the moment this hook changes it — the component has not
  // re-rendered yet at that point, so the prop is a frame behind.
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const setBoth = useCallback((next: Attachment[]) => {
    attachmentsRef.current = next;
    setAttachments(next);
  }, [setAttachments]);

  const addFiles = useCallback(async (files: File[], primed?: PrimedReads): Promise<AddFilesOutcome> => {
    const { accepted, skipped } = applyTextAttachmentBudget(files, attachments);
    if (accepted.length === 0) return { added: 0, skipped, unreadable: [] };

    // Display fields are captured at creation: a File does not survive the
    // queue's JSON round trip or committed history, and every replay path reads
    // these instead of `file`.
    const newAttachments: Attachment[] = accepted.map((file) => ({
      id: Math.random().toString(36).substring(7),
      name: file.name,
      type: file.type,
      size: file.size,
      file,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
    }));
    setBoth([...attachmentsRef.current, ...newAttachments]);

    const { promise: batch, resolve } = Promise.withResolvers<void>();
    pendingReadsRef.current.add(batch);
    const unreadable: string[] = [];
    try {
      await Promise.all(newAttachments.map(async (att) => {
        const file = att.file;
        if (!file) return;
        // The read resolves after this call returns, so it addresses the entry
        // by id — a captured array would be a pre-update snapshot.
        const store = (patch: Partial<Attachment>) => {
          setBoth(attachmentsRef.current.map((a) => (a.id === att.id ? { ...a, ...patch } : a)));
        };
        const label = att.name ?? file.name;

        if (file.type.startsWith('image/')) {
          const base64 = await readAsDataUrl(file, primed);
          if (base64) store({ dataBase64: base64 });
          else unreadable.push(label);
          return;
        }

        // Metadata answers for a classified file; anything else is decided by
        // its bytes, because a promised-file drag names itself `document` and
        // reports no type.
        const classified = isTextAttachment(att);
        const content = await readFileTextWithRetry(file, primed);
        if (content === null) {
          unreadable.push(label);
          return;
        }
        if (content.length === 0) {
          // Nothing came back. A promised file whose bytes never arrive reads
          // empty on every attempt, so this is the only place the user can be
          // told — waiting for the send would just produce an empty prompt.
          unreadable.push(label);
          return;
        }
        const prefix = await primedPrefix(file, primed);
        if (!classified && !(await looksLikeTextFile(file, prefix))) {
          return;
        }
        // The marker travels with the content: without it the send path would
        // re-classify from the same uninformative name and drop it again.
        store({ content, ...(classified ? {} : { sniffedText: true }) });
      }));
    } finally {
      pendingReadsRef.current.delete(batch);
      resolve();
    }

    return { added: newAttachments.length, skipped, unreadable };
  }, [attachments, setAttachments]);

  const removeAttachment = useCallback((id: string) => {
    const att = attachmentsRef.current.find((p) => p.id === id);
    if (att?.preview.startsWith('blob:')) URL.revokeObjectURL(att.preview);
    setBoth(attachmentsRef.current.filter((p) => p.id !== id));
  }, [setBoth]);

  const peek = useCallback(() => attachmentsRef.current, []);

  const clear = useCallback(() => {
    attachmentsRef.current = [];
    setAttachments([]);
  }, [setAttachments]);

  const readyForSend = useCallback(async (): Promise<Attachment[]> => {
    // A batch that finishes during this loop is removed from the set, so the
    // snapshot below is the complete in-flight set at the time of the call.
    while (pendingReadsRef.current.size > 0) {
      await Promise.all([...pendingReadsRef.current]);
    }
    // Yield once so the state updates those reads queued are committed before
    // the list is read back.
    await delay(0);
    return attachmentsRef.current;
  }, []);

  return { addFiles, removeAttachment, readyForSend, peek, clear };
}
