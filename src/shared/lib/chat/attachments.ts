/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Attachment metadata and prompt composition for the chat composer.
 *
 * Two representations of the same attachment exist and the difference is the
 * whole reason this module exists:
 *
 * - A LIVE attachment (just picked/pasted/dropped) carries `file: File`, so its
 *   bytes are readable.
 * - A REPLAYED attachment comes from the `queued_messages` row or from committed
 *   history. `File` does not survive either trip (`JSON.stringify(new File(…))`
 *   is `{}`), so only `name`/`type`/`size`/`preview`/`dataBase64`/`content`
 *   remain.
 *
 * Every read of an attachment's metadata therefore goes through the accessors
 * below, which read the display fields and fall back to the live `File` — never
 * `a.file.name`, which throws on a replayed attachment and is what used to break
 * queued delivery and retry.
 */

import type { AgentImage, Attachment } from '@/shared/types';
import { TEXT_FILE_EXTENSIONS, isTextMimeType } from '@/shared/lib/chat/text-file';

export { looksLikeTextFile } from '@/shared/lib/chat/text-file';

export const MAX_ATTACHED_TEXT_BYTES = 256 * 1024;
export const MAX_ATTACHED_TEXT_FILES = 10;

export interface AttachedTextFileData {
  name: string;
  mimeType: string;
  content: string;
  size: number;
}

/** An inlined text file plus the id of the attachment it came from. */
export interface ReadTextAttachment extends AttachedTextFileData {
  id: string;
  /** True when no bytes could be read — the file is named but not carried. */
  missing?: boolean;
}

function getFileExtension(name: string): string {
  return name.toLowerCase().replace(/\\/g, '/').split('/').pop()?.split('.').pop() ?? '';
}

/** Attachment display name, live file first, persisted name second. */
export function attachmentName(att: Pick<Attachment, 'name' | 'file'>): string {
  return att.name ?? att.file?.name ?? 'attachment';
}

/** Attachment MIME type, live file first, persisted type second. */
export function attachmentType(att: Pick<Attachment, 'type' | 'file'>): string {
  return att.type ?? att.file?.type ?? '';
}

/** Attachment byte size, live file first, persisted size second. */
export function attachmentSize(att: Pick<Attachment, 'size' | 'file'>): number {
  return att.file?.size ?? att.size ?? 0;
}

/** Whether this attachment's contents can be inlined into the prompt. */
export function isTextAttachment(att: Pick<Attachment, 'name' | 'type' | 'file'>): boolean {
  const type = attachmentType(att);
  if (isTextMimeType(type)) return true;
  // An image is never inlined, whatever its extension claims.
  if (type.startsWith('image/')) return false;
  return TEXT_FILE_EXTENSIONS[getFileExtension(attachmentName(att))] === true;
}

/** Whether this attachment is an image the model can receive. */
export function isImageAttachment(att: Pick<Attachment, 'name' | 'type' | 'file'>): boolean {
  return attachmentType(att).startsWith('image/');
}

/** Prefix of a `data:` URL that carries its bytes inline as base64. */
const DATA_URL_BASE64_RE = /^data:[^;,]+;base64,/;

/**
 * Base64 payload carried by a data-URL preview, or null.
 *
 * A row read back from committed history or a queued item has only `preview`,
 * and for an image that preview IS the bytes (`data:image/png;base64,…`) — the
 * load path never sets `dataBase64`. Reading it here is what lets a replayed
 * image still reach the model; without it `attachmentImage` returned null and
 * the picture was silently dropped from a retry or a seeded new chat.
 */
function base64FromPreview(preview: string | undefined): string | null {
  if (!preview || !DATA_URL_BASE64_RE.test(preview)) return null;
  const payload = preview.slice(preview.indexOf(',') + 1);
  return payload.length > 0 ? payload : null;
}

/** Base64 image payload for the omp RPC, or null when there is nothing to send. */
export function attachmentImage(
  att: Pick<Attachment, 'type' | 'file' | 'dataBase64'> & { preview?: string },
): AgentImage | null {
  if (!isImageAttachment(att)) return null;
  const data = att.dataBase64 ?? base64FromPreview(att.preview);
  if (!data) return null;
  return {
    type: 'image',
    data,
    // A persisted attachment carries the authoritative type; the fallback keeps
    // a provider from rejecting a payload whose type the browser left empty.
    mimeType: attachmentType(att) || 'image/png',
  };
}

/**
 * Whether an attachment carries anything the send path can deliver.
 *
 * The composer refuses a send whose only attachments read empty — a prompt that
 * names a file the model never receives. An image counts through EITHER of its
 * byte carriers: a live one has `dataBase64`, while one replayed from committed
 * history has only the data-URL `preview`, and judging it by `dataBase64` alone
 * refused to send a seeded or replayed image that was perfectly readable.
 */
export function attachmentHasPayload(att: Attachment): boolean {
  if ((att.content?.length ?? 0) > 0) return true;
  return attachmentImage(att) !== null;
}

/**
 * Normalize a stored row's attachment list into the composer's `Attachment`
 * shape. Committed history keeps DISPLAY fields only, where `id` and `preview`
 * are optional — but the chip renderer and the send path both read them, so a
 * replayed turn (a retry, a chat seeded from an old message) fills them in here
 * instead of casting the list at each call site.
 */
export function toAttachmentList(
  attachments: { id?: string; name: string; preview?: string; type?: string; size?: number; content?: string }[] | undefined,
): Attachment[] {
  if (!Array.isArray(attachments)) return [];
  return attachments.map((att, index) => ({
    ...att,
    id: att.id ?? `attachment-${index + 1}`,
    preview: att.preview ?? '',
  }));
}

export interface AttachmentBudget {
  /** Files that fit the inline budget and may be attached. */
  accepted: File[];
  /** Text files refused because the budget was already spent. */
  skipped: File[];
}

/** User-facing reason for a refusal, shared by every composer attach path. */
export function describeAttachmentBudget(skipped: File[]): string {
  const limit = `${MAX_ATTACHED_TEXT_FILES} text files / ${Math.round(MAX_ATTACHED_TEXT_BYTES / 1024)} KB total`;
  if (skipped.length === 1) return `"${skipped[0].name}" was not attached — inline limit is ${limit}.`;
  return `${skipped.length} text files were not attached — inline limit is ${limit}.`;
}

/**
 * Gate a batch of incoming files against the text-inline budget.
 *
 * Only text files are gated: their contents are inlined into the prompt, so a
 * directory drop can otherwise push megabytes into a single request. Images and
 * other binaries travel as payloads and are capped by the caller's own limit.
 *
 * The budget spans the whole composer, not the batch — `existing` counts too,
 * so three successive drops of four text files stop at ten.
 */
export function applyTextAttachmentBudget(
  files: File[],
  existing: { name?: string; type?: string; size?: number; file?: File }[],
): AttachmentBudget {
  const accepted: File[] = [];
  const skipped: File[] = [];
  let textFiles = existing.filter((a) => isTextAttachment(a)).length;
  let textBytes = existing.reduce((total, a) => (isTextAttachment(a) ? attachmentSize(a) : total), 0);

  for (const file of files) {
    if (!isTextAttachment({ name: file.name, type: file.type, file })) {
      accepted.push(file);
      continue;
    }
    if (textFiles >= MAX_ATTACHED_TEXT_FILES || textBytes + file.size > MAX_ATTACHED_TEXT_BYTES) {
      skipped.push(file);
      continue;
    }
    textFiles += 1;
    textBytes += file.size;
    accepted.push(file);
  }

  return { accepted, skipped };
}

function languageForFile(name: string): string {
  const extension = getFileExtension(name);
  if (extension === 'md' || extension === 'markdown' || extension === 'mdx') return 'markdown';
  if (extension === 'json' || extension === 'jsonc') return 'json';
  if (extension === 'yaml' || extension === 'yml') return 'yaml';
  if (extension === 'ts' || extension === 'tsx' || extension === 'mts' || extension === 'cts') return 'typescript';
  if (extension === 'js' || extension === 'jsx' || extension === 'mjs' || extension === 'cjs') return 'javascript';
  if (extension === 'py') return 'python';
  if (extension === 'sh' || extension === 'bash' || extension === 'zsh') return 'bash';
  if (extension === 'rs') return 'rust';
  if (extension === 'go') return 'go';
  if (extension === 'sql') return 'sql';
  if (extension === 'html' || extension === 'htm') return 'html';
  if (extension === 'css') return 'css';
  if (extension === 'xml') return 'xml';
  return 'text';
}

function fenceForContent(content: string): string {
  const longestRun = content.match(/`+/g)?.reduce((longest, run) => Math.max(longest, run.length), 0) ?? 0;
  return '`'.repeat(Math.max(3, longestRun + 1));
}

/** Add text-file contents to the prompt while keeping the attachment boundary clear. */
export function composeMessageWithTextAttachments(
  message: string,
  files: AttachedTextFileData[],
): string {
  if (files.length === 0) return message;
  const blocks = files.map((file) => {
    const fence = fenceForContent(file.content);
    return `Attached file: ${file.name}\n${fence}${languageForFile(file.name)}\n${file.content}\n${fence}`;
  });
  return [message.trim(), ...blocks].filter(Boolean).join('\n\n');
}

/**
 * Snapshot attachments for storage in the queue row, where a `File` cannot
 * survive. Reads text contents while the live handle still exists, so delivery
 * can inline them, and keeps every display field the chip renderer needs.
 */
export async function prepareQueuedAttachments(attachments: Attachment[]): Promise<Attachment[]> {
  const textFiles = await readTextAttachments(attachments);
  const contentById = new Map(textFiles.map((file) => [file.id, file.content]));
  return attachments.map((att) => ({
    id: att.id,
    name: attachmentName(att),
    type: attachmentType(att),
    size: attachmentSize(att),
    // The blob URL dies with the page; the data URL survives in the row.
    preview: att.dataBase64 ? `data:${attachmentType(att)};base64,${att.dataBase64}` : att.preview,
    ...(att.dataBase64 ? { dataBase64: att.dataBase64 } : {}),
    ...(contentById.has(att.id) ? { content: contentById.get(att.id) } : {}),
    ...(att.sniffedText ? { sniffedText: true } : {}),
  }));
}

/**
 * The inline-able text files of a batch, reading live `File` bytes where
 * present and persisted `content` otherwise. Returns [] when nothing qualifies.
 *
 * Each entry carries the source attachment's `id`, so the caller can map a file
 * back to the attachment it came from without re-deriving the filter.
 *
 * An attachment with NO readable bytes is returned with `missing: true` rather
 * than dropped: silently omitting it sent a prompt that named a file the model
 * never received, with nothing in the UI to say so. The caller decides whether
 * to warn or to send anyway.
 */
export async function readTextAttachments(
  attachments: Attachment[],
): Promise<ReadTextAttachment[]> {
  // An attachment that already carries `content` was read at attach time — for
  // an unclassified file that read only happened because the sniffer cleared it.
  // Anything else must still classify from metadata, so a binary that happens to
  // have a stray `content` string cannot smuggle itself into the prompt.
  const textAttachments = attachments.filter((a) => isTextAttachment(a) || a.sniffedText === true);
  const contents = await Promise.all(
    textAttachments.map(async (att): Promise<{ content: string | null; missing: boolean }> => {
      // The persisted copy wins: it was read at attach time through
      // `FileReader`, which is the read that waits for another app's file to
      // materialize. Re-reading the live handle here is what returned an empty
      // body for a file whose bytes had already been captured.
      if (typeof att.content === 'string') return { content: att.content, missing: false };
      if (att.file) {
        try {
          return { content: await att.file.text(), missing: false };
        } catch {
          // Fall through to the persisted copy, if any.
        }
      }
      if (typeof att.content === 'string') return { content: att.content, missing: false };
      return { content: null, missing: true };
    }),
  );
  return textAttachments.map((att, index) => ({
    id: att.id,
    name: attachmentName(att),
    mimeType: attachmentType(att),
    content: contents[index].content ?? '',
    size: attachmentSize(att),
    missing: contents[index].missing,
  }));
}
