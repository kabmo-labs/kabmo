/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * BTW panel message body — the scrollable conversation of the active topic.
 *
 * It renders through the CHAT's own `MessageList`, not a btw-specific renderer:
 * a turn's `messages` are `ChatMessageData` (thinking, tool calls, usage,
 * errors), so a tool the side child runs draws the same card it would in the
 * chat, and the two can never drift. This file only assembles the row list —
 * each turn's question as a user row, then that turn's conversation — and adds
 * the btw-only status line for a turn that did not complete cleanly.
 *
 * Pure presentation: no fetch, no session state.
 */

import { useEffect, useMemo, useRef } from 'preact/hooks';
import type { BtwTopic, BtwTurn, BtwTurnStatus, ChatMessageData } from '@/shared/types';
import { MessageList } from '@/client/components/workspace/chat-timeline/MessageList';

export interface BtwMessagesProps {
  topic: BtwTopic | null;
  /** The running turn's conversation, chat-shaped (empty when none). */
  liveMessages: ChatMessageData[];
  /** Panel-level error line, surfaced above the turns. */
  error: string | null;
  provider?: string;
  providerNames?: Record<string, string>;
  modelName?: string;
  /** Thinking level the side child runs at, for the run footer. */
  thinkingLevel?: string;
  isMobile?: boolean;
}

/**
 * Status line for a turn that did not complete cleanly.
 *
 * `running` has no line here: the panel reports a turn in flight with the
 * chat's own `GeneratingIndicator` at the bottom of the card, and a second
 * "Thinking…" under the answer said the same thing twice.
 */
function AnswerStatus({ status }: { status: BtwTurnStatus }) {
  if (status === 'complete' || status === 'running') return null;

  if (status === 'cancelled') {
    return <div className="text-[11px] text-ink/50">Cancelled</div>;
  }

  return <div className="text-[11px] text-error">{status === 'error' ? 'Error' : 'Interrupted'}</div>;
}

/** The question row for a turn, in the chat's own user-bubble shape. */
function questionRow(topic: BtwTopic, turn: BtwTurn): ChatMessageData {
  return {
    id: `btw-${topic.id}-${turn.index}-user`,
    role: 'user',
    content: turn.question,
    timestamp: new Date(turn.createdAt).toISOString(),
  };
}

/**
 * A turn's rows: its stored conversation, or — for a turn written before the
 * conversation was stored — its plain `answer` as a single assistant row.
 * Without this fallback every pre-existing turn would render its question and
 * no answer at all.
 *
 * The child ECHOES the prompt it received, and that echo is the `<btw>` wrapper
 * this panel itself built — the caller already renders the user's own question
 * as a row, so the echo is dropped rather than shown as a second, uglier copy
 * of the same turn.
 */
function turnRows(topic: BtwTopic, turn: BtwTurn): ChatMessageData[] {
  const conversation = turn.messages.filter((message) => message.role !== 'user');
  if (conversation.length > 0) return conversation;
  if (!turn.answer) return [];
  return [
    {
      id: `btw-${topic.id}-${turn.index}-answer`,
      role: 'ai',
      content: turn.answer,
      timestamp: new Date(turn.updatedAt).toISOString(),
    },
  ];
}

export function BtwMessages({ topic, liveMessages, error, provider, providerNames, modelName, thinkingLevel, isMobile = false }: BtwMessagesProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const turns = topic?.turns ?? [];

  // One row list for the whole topic: each question, then its conversation. The
  // running turn's live rows replace its (still empty) stored ones.
  const rows = useMemo<ChatMessageData[]>(() => {
    if (!topic) return [];
    return turns.flatMap((turn) => {
      const running = turn.status === 'running' && liveMessages.length > 0;
      // The live buffer carries the same echoed prompt the stored conversation
      // does, so it is filtered the same way (see `turnRows`).
      const conversation = running ? liveMessages.filter((message) => message.role !== 'user') : turnRows(topic, turn);
      return [questionRow(topic, turn), ...conversation];
    });
  }, [topic, turns, liveMessages]);

  // Cheap scroll signal: any visible text growth (stream delta, new question,
  // topic switch) changes this number.
  const renderedLength = useMemo(
    () => rows.reduce((total, row) => total + row.content.length + (row.toolCalls?.length ?? 0) * 64, 0),
    [rows],
  );

  useEffect(() => {
    const body = scrollRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [renderedLength]);

  return (
    <div
      ref={scrollRef}
      className="flex-1 min-h-0 overflow-y-auto scrollbar-overlay-container px-4 py-3"
    >
      {error && (
        <div className="bg-error/10 border border-error/30 text-error rounded-lg px-3 py-2 text-[12px]">{error}</div>
      )}

      {topic === null ? (
        <div className="flex min-h-[72px] items-center justify-center px-4 text-center text-[12px] text-ink/50">
          Ask a question above — the answer stays out of this chat's transcript.
        </div>
      ) : (
        <>
          <MessageList
            messages={rows}
            isGenerating={topic.turns.some((turn) => turn.status === 'running')}
            provider={provider}
            providerNames={providerNames}
            modelName={modelName}
            thinkingLevel={thinkingLevel}
            isMobile={isMobile}
            userActions={false}
          />
          {/* A turn that stopped without completing is the only thing the chat's
              own rows cannot express, so it is the only btw-specific line. */}
          {turns
            .filter((turn) => turn.status !== 'complete' && turn.status !== 'running')
            .map((turn) => (
              <AnswerStatus key={turn.index} status={turn.status} />
            ))}
        </>
      )}
    </div>
  );
}
