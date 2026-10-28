/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The one place a stored prompt becomes an omp command.
 *
 * Two dispatchers send prompts nobody typed in this tab: the follow-up queue
 * (`queue/delivery.server.ts`) and a prompt held until another session finishes
 * (`waiting/runtime.server.ts`). They carry the SAME persisted shape — a text,
 * an attachment list whose live `File` did not survive the JSON round trip, and
 * an optional model snapshot — so a second copy of this assembly is how the two
 * drift (one inlining a text file, the other sending a bare filename).
 *
 * The attachment rules are read off the fields that DID persist:
 *
 *   - `dataBase64` holds an image's bytes; `type` its media type. Matching on a
 *     `data:` preview yields zero images, because the composer's preview is a
 *     `blob:` object URL the server cannot read.
 *   - `content` is an inlined text file. Without it a queued attachment
 *     delivers as a filename mention instead of the file.
 */

import type { Attachment, QueuedMessageModel } from '@/shared/types/chat';
import { composeMessageWithTextAttachments } from '@/shared/lib/chat/attachments';

export interface StoredPrompt {
  text: string;
  attachments: Attachment[];
  model: QueuedMessageModel | null;
}

/** The `prompt` command (with any images) a stored prompt dispatches. */
export function promptCommand(prompt: StoredPrompt): Record<string, unknown> {
  const images = prompt.attachments
    .filter((attachment) => typeof attachment?.dataBase64 === 'string' && attachment.dataBase64.length > 0)
    .map((attachment) => ({
      type: 'image' as const,
      data: attachment.dataBase64 as string,
      mimeType: typeof attachment.type === 'string' && attachment.type.startsWith('image/')
        ? attachment.type
        : 'image/png',
    }));
  const textFiles = prompt.attachments
    .filter((attachment) => typeof attachment?.content === 'string' && attachment.content.length > 0)
    .map((attachment) => ({
      name: typeof attachment.name === 'string' && attachment.name ? attachment.name : 'attachment',
      mimeType: typeof attachment.type === 'string' ? attachment.type : 'text/plain',
      content: attachment.content as string,
      size: typeof attachment.size === 'number' ? attachment.size : (attachment.content as string).length,
    }));
  return {
    type: 'prompt',
    message: composeMessageWithTextAttachments(prompt.text, textFiles),
    ...(images.length ? { images } : {}),
    ...(prompt.model ? { accessMode: prompt.model.accessMode } : {}),
  };
}

/** Apply a stored model snapshot to a live child before its prompt. */
export async function applyModelSnapshot(
  send: (command: Record<string, unknown>) => Promise<unknown>,
  model: QueuedMessageModel | null,
): Promise<void> {
  if (!model) return;
  await send({ type: 'set_model', provider: model.provider, modelId: model.modelId });
  // 'auto' thinking leaves omp's level alone: the snapshot records "no pick",
  // not a level named auto.
  if (model.thinkingLevel !== 'auto') {
    await send({ type: 'set_thinking_level', level: model.thinkingLevel });
  }
}
