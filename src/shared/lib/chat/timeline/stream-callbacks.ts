/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Builds the SSE stream-chunk callback object passed to streamChatResponse for
 * the mock / Kabmo-created session path in useChatTimeline. Extracted so the
 * timeline hook stays under the repo's per-file size ceiling. Closures mutate
 * the caller's state, so they arrive via a single deps record and are read as
 * `deps.*` — captured semantics are unchanged.
 */

import type { Dispatch, SetStateAction } from 'preact/compat';
import type { ChatMessageData } from '@/shared/types';
import type { StreamChunkCallbacks } from '@/client/hooks/chat/stream';
import { triggerChatCompletionSound } from '@/client/hooks/ui/notification-sound';
import { createRafBatch } from '@/shared/lib/chat/timeline/stream-raf';
import { PHASE_VERBS } from '@/shared/lib/chat/timeline/tool-phrases';
import { describeToolCall } from '@/shared/lib/chat/timeline/tool-verbs';

export interface MockStreamCallbacksDeps {
  aiPlaceholderId: string;
  setLocalMessages: Dispatch<SetStateAction<ChatMessageData[]>>;
  persistMessages: (messages: any[]) => void;
  setGenerating: (v: boolean) => void;
  /** Live activity phrase for the indicator (tool call / phase). */
  setGeneratingVerb: (v: string) => void;
  abortControllerRef: { current: AbortController | null };
  appSettings: Record<string, any>;
  /** Follow-gated stream scroll: no-ops while the user has scrolled away. */
  scrollToBottom: (behavior?: ScrollBehavior) => void;
}

export function createMockStreamCallbacks(deps: MockStreamCallbacksDeps): StreamChunkCallbacks {
  const {
    aiPlaceholderId,
    setLocalMessages,
    persistMessages,
    setGenerating,
    setGeneratingVerb,
    abortControllerRef,
    appSettings,
    scrollToBottom,
  } = deps;

  // Coalesce the SSE deltas into one commit per animation frame. Deltas are
  // incremental, so every queued updater runs in arrival order; a smooth scroll
  // fires once per frame, after the updates land.
  let scrollPending = false;
  const batch = createRafBatch<ChatMessageData[]>(
    updater => setLocalMessages(updater),
    () => {
      if (!scrollPending) return;
      scrollPending = false;
      scrollToBottom('smooth');
    },
  );
  const enqueue = (updater: (prev: ChatMessageData[]) => ChatMessageData[], scroll = false) => {
    if (scroll) scrollPending = true;
    batch.queue(updater);
  };

  return {
    onInit: (data) => {
      enqueue(prev =>
        prev.map(m => (m.id === aiPlaceholderId ? { ...m, id: data.id, date: data.date } : m))
      );
    },
    onThinkingStart: () => {
      setGeneratingVerb(PHASE_VERBS.thinking);
      enqueue(prev =>
        prev.map(m =>
          m.id === aiPlaceholderId || m.role === 'ai'
            ? { ...m, thinking: { thought: '', isGenerating: true } }
            : m
        )
      );
      setTimeout(() => scrollToBottom('smooth'), 50);
    },
    onThinkingChunk: (data) => {
      enqueue(prev =>
        prev.map(m => {
          if (m.id === aiPlaceholderId || (m.role === 'ai' && prev[prev.length - 1]?.id === m.id)) {
            const currentThought = typeof m.thinking === 'object' ? m.thinking.thought || '' : '';
            return {
              ...m,
              thinking: { thought: currentThought + data.delta, isGenerating: true },
            };
          }
          return m;
        }), true
      );
    },
    onThinkingEnd: (data) => {
      enqueue(prev =>
        prev.map(m => {
          if (m.id === aiPlaceholderId || (m.role === 'ai' && prev[prev.length - 1]?.id === m.id)) {
            return {
              ...m,
              thinking: {
                thought: data.thought,
                summary: data.summary,
                duration: data.duration,
                isGenerating: false,
              },
            };
          }
          return m;
        })
      );
    },
    onToolStart: (data) => {
      setGeneratingVerb(describeToolCall(data));
      enqueue(prev =>
        prev.map(m => {
          if (m.id === aiPlaceholderId || (m.role === 'ai' && prev[prev.length - 1]?.id === m.id)) {
            return {
              ...m,
              toolCalls: [...(m.toolCalls || []), data],
            };
          }
          return m;
        })
      );
      setTimeout(() => scrollToBottom('smooth'), 50);
    },
    onToolOutputChunk: (data) => {
      enqueue(prev =>
        prev.map(m => {
          if (m.id === aiPlaceholderId || (m.role === 'ai' && prev[prev.length - 1]?.id === m.id)) {
            return {
              ...m,
              toolCalls: (m.toolCalls || []).map(t =>
                t.id === data.id ? { ...t, output: (t.output || '') + data.delta } : t
              ),
            };
          }
          return m;
        }), true
      );
    },
    onToolEnd: (data) => {
      setGeneratingVerb(PHASE_VERBS.thinking);
      enqueue(prev =>
        prev.map(m => {
          if (m.id === aiPlaceholderId || (m.role === 'ai' && prev[prev.length - 1]?.id === m.id)) {
            return {
              ...m,
              toolCalls: (m.toolCalls || []).map(t => (t.id === data.id ? { ...t, ...data } : t)),
            };
          }
          return m;
        })
      );
    },
    onContentChunk: (data) => {
      setGeneratingVerb(PHASE_VERBS.writing);
      enqueue(prev =>
        prev.map(m => {
          if (m.id === aiPlaceholderId || (m.role === 'ai' && prev[prev.length - 1]?.id === m.id)) {
            return {
              ...m,
              content: (m.content || '') + data.delta,
            };
          }
          return m;
        }), true
      );
    },
    onSummary: (data) => {
      enqueue(prev =>
        prev.map(m => {
          if (m.id === aiPlaceholderId || (m.role === 'ai' && prev[prev.length - 1]?.id === m.id)) {
            return { ...m, summary: data.summary };
          }
          return m;
        })
      );
    },
    onDone: (data) => {
      batch.flush();
      setLocalMessages(prev => {
        const updated = prev.map(m =>
          m.id === aiPlaceholderId || (m.role === 'ai' && prev[prev.length - 1]?.id === m.id)
            ? data.message
            : m
        );
        persistMessages(updated);
        return updated;
      });
      setGenerating(false);
      abortControllerRef.current = null;
      triggerChatCompletionSound(appSettings);
      setTimeout(() => scrollToBottom('smooth'), 50);
    },
    onError: () => {
      setGenerating(false);
      abortControllerRef.current = null;
    },
  };
}
