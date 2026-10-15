/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure pieces of the chat send path, split out of `send.ts` so that hook stays
 * under the size ceiling: the optimistic row pair a send renders, the image
 * payload a delivery carries, and the simulated SSE fallback.
 */

import type { Dispatch, SetStateAction } from 'preact/compat';
import type { AgentImage, Attachment, ChatMessageData, PromptDispatchResult } from '@/shared/types';
import { streamChatResponse } from '@/client/hooks/chat/stream';
import { createMockStreamCallbacks } from '@/shared/lib/chat/timeline/stream-callbacks';
import { attachmentImage, attachmentName, attachmentSize, attachmentType } from '@/shared/lib/chat/attachments';

/** The image payload of a delivery: the attachments that carry real bytes. A
 *  replayed attachment has no live `File`, so it is dropped unless the data
 *  URL preview survived — the same predicate the composer's send guard uses. */
export function collectImages(attachments: Attachment[]): AgentImage[] | undefined {
  const images = attachments
    .map(attachmentImage)
    .filter((image): image is AgentImage => image !== null);
  return images.length ? images : undefined;
}

/** The two optimistic rows a send renders before any child answers: the user's
 *  own turn and the AI placeholder it streams into. */
export function buildOptimisticRows(args: {
  text: string;
  attachments: Attachment[];
  /** Attachment id → inlined file content, for the editor view. */
  textContentById: Map<string, string | undefined>;
  time: string;
  now: number;
  userMsgId: string;
  aiPlaceholderId: string;
}): { newUserMsg: ChatMessageData; initialAiMsg: ChatMessageData } {
  const { text, attachments, textContentById, time, now, userMsgId, aiPlaceholderId } = args;
  return {
    newUserMsg: {
      id: userMsgId,
      role: 'user',
      date: `Today, ${time}`,
      // Precise epoch anchor: the footer run-duration measures from here until
      // the last AI message. The display `date` label is minute-granular, so a
      // string fallback would inflate the measured span by up to 59s.
      startedAt: now,
      content: text,
      attachments: attachments.map((a) => ({
        name: attachmentName(a),
        // The blob URL only lives as long as this page, so the data URL wins
        // where it exists — a persisted turn re-renders its images from it.
        preview: a.dataBase64 ? `data:${attachmentType(a)};base64,${a.dataBase64}` : a.preview,
        type: attachmentType(a),
        size: attachmentSize(a),
        content: textContentById.get(a.id),
      })),
    },
    initialAiMsg: { id: aiPlaceholderId, role: 'ai', date: `Today, ${time}`, startedAt: now, content: '' },
  };
}

/** The simulated SSE path, taken by a chamber-created session and as the
 *  fallback when a real spawn is impossible (MOCK mode, no workspace cwd). */
export async function streamMockFallback(args: {
  sessionId: string | null;
  text: string;
  attachments: Attachment[];
  workspaceName: string;
  aiPlaceholderId: string;
  abortControllerRef: { current: AbortController | null };
  optimisticUserIdRef: { current: string | null };
  appSettings: Record<string, any>;
  setLocalMessages: Dispatch<SetStateAction<ChatMessageData[]>>;
  persistMessages: (messages: any[]) => void;
  setGenerating: (v: boolean, owned?: boolean) => void;
  setGeneratingVerb: (v: string) => void;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
}): Promise<PromptDispatchResult> {
  const { abortControllerRef, optimisticUserIdRef } = args;
  // A simulated turn owns no omp run, so it never claims one.
  optimisticUserIdRef.current = null;
  if (abortControllerRef.current) abortControllerRef.current.abort();
  const abortController = new AbortController();
  abortControllerRef.current = abortController;

  await streamChatResponse(
    {
      sessionId: args.sessionId || `session-${Date.now()}`,
      prompt: args.text,
      workspaceName: args.workspaceName,
      attachments: args.attachments,
      signal: abortController.signal,
    },
    createMockStreamCallbacks({
      aiPlaceholderId: args.aiPlaceholderId,
      setLocalMessages: args.setLocalMessages,
      persistMessages: args.persistMessages,
      setGenerating: args.setGenerating,
      setGeneratingVerb: args.setGeneratingVerb,
      abortControllerRef,
      appSettings: args.appSettings,
      scrollToBottom: args.scrollToBottom,
    }),
  );
  return { ok: true, busy: false };
}
