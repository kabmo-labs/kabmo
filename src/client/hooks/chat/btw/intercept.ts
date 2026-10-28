/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `/btw [question]` typed into the main composer is the side-question entry
 * point, not chat text: the panel owns the token (omp's `/btw` is TUI-only, so
 * nothing downstream would understand it). This module is the whole
 * interception — recognize the command and hand it, with the composer's
 * attachments, to the panel over `omp:btw`.
 *
 * The attachments cross as the composer's own `Attachment` objects, not as
 * pre-built provider payloads: the side session accepts the same shapes the chat
 * does (images as payloads, text files inlined into the prompt), and it makes
 * that split itself — from the fields the attach step already filled in.
 *
 * It lives beside the rest of the client-side btw state (`hooks/chat/btw/`)
 * rather than in the send handler: the attachment read goes through the shared
 * accessors, because `Attachment.file` is absent on every replayed attachment.
 */

import type { Attachment } from '@/shared/types';

/** A bare `/btw` opens the form on the current history; anything after it is
 *  the first question. Case-insensitive, because omp's command tokens are, and
 *  the separator is whitespace OR `:` — `parseSlashCommand` splits on whichever
 *  comes first, so `/btw:what is this` is the same invocation as `/btw what is
 *  this` and must not be sent to the model as text. */
const BTW_COMMAND_RE = /^\/btw(?:[\s:]+([\s\S]*))?$/i;

/**
 * Hand a `/btw` draft to the side-question panel. Returns false when the text
 * is not a btw command, so the caller keeps its normal send path.
 */
export function dispatchBtwCommand(text: string, attachments: Attachment[]): boolean {
  const match = BTW_COMMAND_RE.exec(text);
  if (!match) return false;

  window.dispatchEvent(
    new CustomEvent('omp:btw', {
      detail: { question: match[1]?.trim() ?? '', ...(attachments.length ? { attachments } : {}) },
    }),
  );
  return true;
}
