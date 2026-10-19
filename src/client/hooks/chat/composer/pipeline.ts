/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The composer's attach-and-send pipeline: everything between "a file arrived"
 * and "a prompt is dispatched", plus the one line of feedback each outcome
 * produces.
 *
 * Extracted from ChatInput so the component stays a layout shell and the
 * composer keeps room under the repo's per-file size ceiling.
 *
 * The rules encoded here, each of which was a bug once:
 *
 * - A drop registers its files in the attachment hook BEFORE the component
 *   re-renders, so a send clicked immediately afterwards must read the hook's
 *   list, not the component's `attachments` prop — that prop is a frame behind
 *   and an empty read clears the composer and dispatches nothing.
 * - A send waits for in-flight reads and then uses the list those reads
 *   returned: an attachment whose bytes landed during the wait is sent
 *   complete, never as the pre-read entry.
 * - A send that would carry neither text nor any readable attachment is
 *   REPORTED, never dispatched. An empty prompt reaching the model is worse
 *   than not sending, and it is what a failed read used to produce.
 */

import { useCallback, useRef, useState } from 'preact/hooks';
import type { SetStateAction } from 'preact/compat';
import type { Attachment } from '@/shared/types';
import { attachmentHasPayload, attachmentName, describeAttachmentBudget } from '@/shared/lib/chat/attachments';
import { useComposerAttachments } from '@/client/hooks/chat/composer/attachments';
import { useFileDrop, DROP_LIMIT_NOTICE, type FileDropProps } from '@/client/hooks/chat/composer/file-drop';
import type { PrimedReads } from '@/client/hooks/chat/composer/file-reads';
import {
  describeReferenceFailure,
  describeUnreadable,
  readDroppedReference,
  referenceName,
  type ReferenceFailure,
} from '@/client/hooks/chat/composer/drop-references';

export interface UseComposerPipelineOptions {
  attachments: Attachment[];
  setAttachments: (updater: SetStateAction<Attachment[]>) => void;
  /** Current composer text, read at send time. */
  value: string;
  disabled: boolean;
  /** Workspace root, used to resolve a dropped path reference. */
  rootPath?: string | null;
  onSend: (attachments: Attachment[], options?: { steering?: boolean }) => void;
}

export interface ComposerPipeline {
  /** Inline notice shown above the input; null when there is nothing to say. */
  notice: string | null;
  dismissNotice: () => void;
  /** True while a file drag hovers the composer. */
  isDragging: boolean;
  /** Drag handlers for the composer card. */
  dropProps: FileDropProps;
  /** Attach a batch (picker, paste, or a drop the caller already parsed). */
  acceptFiles: (files: File[], incomplete?: boolean, references?: string[], primed?: PrimedReads) => void;
  /** Remove one attachment. */
  removeAttachment: (id: string) => void;
  /** Send the composer's contents. */
  submit: (options?: { steering?: boolean }) => void;
}

export function useComposerPipeline({
  attachments,
  setAttachments,
  value,
  disabled,
  rootPath,
  onSend,
}: UseComposerPipelineOptions): ComposerPipeline {
  const { addFiles, removeAttachment, readyForSend, peek, clear } = useComposerAttachments({ attachments, setAttachments });
  // Guards a double click: the composer is cleared only after the reads land, so
  // without this a second click would dispatch the same attachment twice.
  const sendingRef = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);

  // A download dragged out of a web page carries no File — only a URL. The
  // server reads it, because the browser cannot fetch an arbitrary path and the
  // drop gives no bytes to work with.
  const attachReferences = useCallback(async (references: string[]) => {
    const resolved: File[] = [];
    const failed: string[] = [];
    const reasons = new Map<string, ReferenceFailure>();
    await Promise.all(references.map(async (reference) => {
      const name = referenceName(reference);
      const result = await readDroppedReference(reference, rootPath ?? null);
      if (result.ok) {
        resolved.push(result.file);
        return;
      }
      failed.push(name);
      reasons.set(name, result.reason);
    }));
    if (resolved.length > 0) {
      const { unreadable } = await addFiles(resolved);
      setNotice(unreadable.length > 0 ? describeUnreadable(unreadable) : null);
    }
    if (failed.length > 0) {
      // Named per cause: "outside the folders Kabmo may read" is something
      // the user can act on, while a bare "could not be read" is not.
      const reason = reasons.get(failed[0]) ?? 'unavailable';
      setNotice(describeReferenceFailure(failed, reason));
    }
  }, [addFiles, rootPath]);

  const acceptFiles = useCallback((
    files: File[],
    incomplete = false,
    references: string[] = [],
    primed?: PrimedReads,
  ) => {
    void (async () => {
      const { added, skipped, unreadable } = await addFiles(files, primed);
      if (skipped.length > 0) {
        setNotice(describeAttachmentBudget(skipped));
      } else if (incomplete) {
        setNotice(DROP_LIMIT_NOTICE);
      } else if (unreadable.length > 0) {
        // Reported, never silent: a chip whose bytes never arrived would send a
        // prompt that names a file the model cannot see.
        setNotice(describeUnreadable(unreadable));
      } else if (added > 0) {
        setNotice(null);
      }
      if (references.length > 0) await attachReferences(references);
    })();
  }, [addFiles, attachReferences]);

  // OS drag-and-drop. Bound to the composer CARD, not the textarea: the whole
  // composer is the drop target, so a drop anywhere inside it (including on the
  // textarea) bubbles here instead of letting the browser navigate away.
  const { isDragging, dropProps } = useFileDrop({ disabled, onFiles: acceptFiles });

  const submit = useCallback((options?: { steering?: boolean }) => {
    // The hook's list, not the prop: a drop registers its files before this
    // component re-renders, so a send clicked right after a drop would see an
    // empty prop, clear the composer and dispatch a prompt carrying nothing.
    const pending = peek();
    if (!value.trim() && pending.length === 0) {
      return;
    }
    if (sendingRef.current) {
      return;
    }
    sendingRef.current = true;
    // Bytes are read at attach time; waiting here returns the list as it stands
    // once those reads land, so an attachment whose read was still in flight is
    // sent complete rather than empty.
    void readyForSend().then((outgoing) => {
      clear();
      // "Readable" means there is something TO SEND. An attachment whose read
      // produced an empty string has a `content` field but no content, and
      // treating that as readable is how a prompt with an empty body went out.
      // An image is judged through either byte carrier, so one replayed from
      // committed history (data-URL `preview`, no `dataBase64`) still sends.
      const readable = outgoing.some(attachmentHasPayload);
      if (!value.trim() && outgoing.length > 0 && !readable) {
        setNotice(describeUnreadable(outgoing.map((a) => attachmentName(a))));
        return;
      }
      onSend(outgoing, options);
    }).finally(() => {
      sendingRef.current = false;
    });
  }, [clear, onSend, peek, readyForSend, value]);

  return {
    notice,
    dismissNotice: useCallback(() => setNotice(null), []),
    isDragging,
    dropProps,
    acceptFiles,
    removeAttachment,
    submit,
  };
}
