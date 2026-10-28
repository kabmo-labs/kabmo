/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Live BTW state for one session: the topic list, the answer streaming right
 * now, and the commands that drive them.
 *
 * The server owns the state — every frame is a full snapshot or a delta, and
 * every command answers with the canonical state — so this hook keeps no
 * merge logic of its own and a reload can never disagree with the server.
 * The stream is attached only while the panel is open: a side question is a
 * deliberate action, not background traffic.
 *
 * There are no per-topic pickers here. A side question runs without tools and on
 * the CHAT's model and thinking selector (the server re-reads them from the
 * parent transcript at every ask), which is what omp's own `/btw` does.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { AgentImage, Attachment, BtwFrame, BtwState, ChatMessageData } from '@/shared/types';
import { realtimeClient } from '@/shared/lib/realtime/client';
import { btwTopic } from '@/shared/lib/realtime/protocol';
import { attachmentImage, readTextAttachments } from '@/shared/lib/chat/attachments';
import {
  BtwRequestError,
  abortBtwQuestion,
  askBtwQuestion,
  deleteBtwTopic,
  fetchBtwState,
  promoteBtwTopic,
} from '@/shared/lib/chat/btw/client';

/** Images the side session accepts, already read as base64. */
export type BtwImage = AgentImage;

/**
 * The turn streaming right now. `messages` is the turn's conversation in the
 * chat's own shape, upserted by `message.id` exactly as the chat stream does —
 * so the panel renders a live side answer through the same components the chat
 * uses.
 */
export interface BtwLiveAnswer {
  topicId: string;
  turnIndex: number;
  messages: ChatMessageData[];
  /** Activity phrase for the panel's indicator, from the side child's frames. */
  activity: string;
}

export interface BtwSessionHandle {
  state: BtwState | null;
  live: BtwLiveAnswer | null;
  error: string | null;
  /** A command is in flight — the panel disables its actions meanwhile. */
  busy: boolean;
  /** Resolves with the canonical state the command produced, or null when it
   *  was refused (the reason is then in `error`). */
  ask: (question: string, attachments?: Attachment[], topicId?: string) => Promise<BtwState | null>;
  abort: (topicId: string) => Promise<void>;
  /** Returns the new session id to open, or null when it was refused. */
  promote: (topicId: string) => Promise<string | null>;
  remove: (topicId: string) => Promise<void>;
  clearError: () => void;
}

export interface BtwSessionOptions {
  /** Attach the frame stream (the panel is open). */
  enabled: boolean;
}

export function useBtwSession(sessionId: string | null, options: BtwSessionOptions): BtwSessionHandle {
  const [state, setState] = useState<BtwState | null>(null);
  const [live, setLive] = useState<BtwLiveAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { enabled } = options;

  // Commands must not be bound to the render that produced them: `/btw <q>`
  // asks from the same tick that opens the form, before the stream attached and
  // before this hook re-rendered with a session — a captured `sessionId` there
  // would be null and the question would silently go nowhere.
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  useEffect(() => {
    if (!enabled || !sessionId) return;

    // The side-question frames ride the shared realtime socket's `btw:<id>`
    // topic. Its SNAPSHOT is the same `btw_state` the server used to send as the
    // stream's first frame, so a client attaching mid-turn (a reload, a second
    // tab) still shows the answer the child already produced.
    const unsubscribe = realtimeClient.subscribeFrames(btwTopic(sessionId), ({ payload }) => {
      const frame = payload as BtwFrame;
      switch (frame.type) {
          case 'btw_state':
            setState(frame.state);
            // The snapshot carries the running turn's conversation, so a client
            // attaching mid-turn (a reload, a second tab) shows the answer the
            // child already produced instead of an empty bubble. A snapshot with
            // no live turn ends the local buffer — the persisted rows own it now.
            setLive(frame.state.live
              ? {
                  topicId: frame.state.live.topicId,
                  turnIndex: frame.state.live.turnIndex,
                  messages: frame.state.live.messages,
                  activity: frame.state.live.activity,
                }
              : null);
            break;
          case 'btw_message':
            // Same upsert the chat stream performs: omp emits one frame per
            // segment carrying that segment's full accumulated content, so a
            // same-id frame replaces in place and a new id appends.
            setLive((current) => {
              const base =
                current && current.topicId === frame.topicId && current.turnIndex === frame.turnIndex
                  ? current
                  : { topicId: frame.topicId, turnIndex: frame.turnIndex, messages: [], activity: '' };
              const existing = base.messages.findIndex((message) => message.id === frame.message.id);
              const messages =
                existing === -1
                  ? [...base.messages, frame.message]
                  : [...base.messages.slice(0, existing), frame.message, ...base.messages.slice(existing + 1)];
              return { ...base, messages };
            });
            break;
          case 'btw_activity':
            setLive((current) =>
              current && current.topicId === frame.topicId ? { ...current, activity: frame.verb } : current,
            );
            break;
          case 'btw_error':
            setError(frame.message);
            break;
        default:
          break;
      }
    });

    // The topic snapshot is delivered on subscribe, so this is only a fallback
    // for a session whose topic has no resolver (MOCK mode, or a btw id the
    // server does not serve) — the frames are authoritative when they arrive.
    void fetchBtwState(sessionId)
      .then(setState)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));

    return () => unsubscribe();
  }, [enabled, sessionId]);

  const run = useCallback(
    async (operation: (id: string) => Promise<BtwState>): Promise<BtwState | null> => {
      const id = sessionIdRef.current;
      if (!id) return null;
      setBusy(true);
      try {
        const next = await operation(id);
        setState(next);
        return next;
      } catch (cause) {
        setError(cause instanceof BtwRequestError || cause instanceof Error ? cause.message : String(cause));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const ask = useCallback(
    async (
      question: string,
      attachments: Attachment[] = [],
      topicId?: string,
    ): Promise<BtwState | null> => {
      setError(null);
      // Same split the chat send path makes: images travel as provider payloads,
      // text files are inlined into the prompt. Both are read here, from the
      // attachments the composer already filled in at attach time.
      const images = attachments
        .map((attachment) => attachmentImage(attachment))
        .filter((image): image is NonNullable<typeof image> => image !== null);
      const textFiles = (await readTextAttachments(attachments)).filter((file) => !file.missing);
      const next = await run((id) => askBtwQuestion(id, {
        question,
        topicId,
        ...(images.length ? { images } : {}),
        ...(textFiles.length ? { textFiles } : {}),
      }));
      setLive(null);
      if (next && !next.runningTopicId) {
        setError('The side question was accepted but did not start running.');
      }
      return next;
    },
    [run],
  );

  const abort = useCallback(
    async (topicId: string) => {
      setError(null);
      await run((id) => abortBtwQuestion(id, topicId));
    },
    [run],
  );

  const remove = useCallback(
    async (topicId: string) => {
      setError(null);
      await run((id) => deleteBtwTopic(id, topicId));
    },
    [run],
  );

  const promote = useCallback(
    async (topicId: string): Promise<string | null> => {
      const id = sessionIdRef.current;
      if (!id) return null;
      setError(null);
      setBusy(true);
      try {
        const created = await promoteBtwTopic(id, topicId);
        return created.sessionId;
      } catch (cause) {
        setError(cause instanceof BtwRequestError || cause instanceof Error ? cause.message : String(cause));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const clearError = useCallback(() => setError(null), []);

  return { state, live, error, busy, ask, abort, promote, remove, clearError };
}
