/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * BTW mode: the state behind the side-question form.
 *
 * Entering the mode replaces the chat composer with the form itself — an ask
 * card ("Ask your question", always a new topic) above the side session's
 * composer (follow-ups to the topic in view). The mode flag, both drafts and
 * the selected topic live in per-session state, so a reload lands back in the
 * form the user left and leaving the mode loses nothing.
 *
 * `/btw [question]` in the main composer is the entry point; a question that
 * arrived with the command is asked immediately, which is what the TUI does.
 *
 * The panel has no model / thinking / access pickers: a side question runs on
 * the chat's own model and thinking selector and without tools, so a control
 * here would promise something the child does not read.
 */

import { useCallback, useState } from 'preact/hooks';
import type { Attachment, BtwState, BtwTopic, ChatMessageData } from '@/shared/types';
import { useBtwSession, type BtwLiveAnswer } from '@/client/hooks/chat/btw';
import { useKabmoEvent } from '@/client/hooks/ui/window-event';
import { useSessionState } from '@/client/hooks/workspace/session-state';
import { useSearchParams } from '@/client/lib/router/search-params';
import { PHASE_VERBS } from '@/shared/lib/chat/timeline/tool-phrases';

/** Question sent when a question arrived carrying only images. */
const ATTACHMENT_ONLY_QUESTION = 'Describe the attached image.';

export interface BtwMode {
  open: boolean;
  topics: BtwTopic[];
  activeTopic: BtwTopic | null;
  /** Topic with a turn in flight, if any. */
  runningTopicId: string | null;
  /** A command is still in flight — the panel holds its actions meanwhile. */
  busy: boolean;
  /** The running turn's conversation, chat-shaped; empty when none. */
  liveMessages: ChatMessageData[];
  /** What that turn is doing, for the panel's indicator (side stream's own). */
  liveVerb?: string;
  error: string | null;
  askDraft: string;
  followUpDraft: string;
  setAskDraft: (value: string) => void;
  setFollowUpDraft: (value: string) => void;
  /** Open the form on the current history (bare `/btw`). */
  enter: () => void;
  /** Leave the form; drafts and history stay. */
  exit: () => void;
  /** ⟳ — clear the question in flight and let the newest topic show. */
  resetQuestion: () => void;
  /** Submit the ask card: a question of its own. */
  submitAsk: () => void;
  /** Submit the side session's composer: a follow-up to the active topic. */
  submitFollowUp: (question: string, attachments?: Attachment[]) => void;
  /** Cancel the running turn, if any. Returns whether one was running. */
  abort: () => boolean;
  /** Returns the session id to open, or null when promotion was refused. */
  promote: () => Promise<string | null>;
  removeTopic: (topicId: string) => void;
  selectTopic: (topicId: string) => void;
  clearError: () => void;
}

export function useBtwMode(sessionId: string | null): BtwMode {
  /**
   * Whether the panel is on screen. Deliberately NOT restored from session
   * state: a panel that reopens itself on every load leaves the user with no
   * chat composer and a field they did not ask for, and a `/btw` typed into
   * that field becomes a real question to the model. The panel is a mode the
   * user enters, so every load starts in the chat.
   *
   * The drafts and the selected topic DO persist (`chat.btwAsk` and friends):
   * leaving and re-entering the panel loses nothing, which is what those slots
   * are for.
   */
  const [open, setOpen] = useState(false);
  const [askDraft, setAskDraft] = useSessionState<string>('chat.btwAsk', '');
  const [followUpDraft, setFollowUpDraft] = useSessionState<string>('chat.btwFollowUp', '');
  const [selectedTopicId, setSelectedTopicId] = useSessionState<string | null>('chat.btwTopicId', null);
  const [, setSearchParams] = useSearchParams();

  // `enabled` only gates the stream: the commands must work the moment the form
  // opens, which is before the stream has attached.
  const session = useBtwSession(sessionId, { enabled: open && Boolean(sessionId) });

  const topics = session.state?.topics ?? [];
  const activeTopic = topics.find((topic) => topic.id === selectedTopicId) ?? topics[topics.length - 1] ?? null;
  const runningTopicId = session.state?.runningTopicId ?? null;
  const live: BtwLiveAnswer | null = session.live && session.live.topicId === activeTopic?.id ? session.live : null;

  /**
   * What the running turn is doing, for the panel's indicator.
   *
   * The verb is the SERVER's, derived from the side child's own frames
   * (`describeAssistantPhase` / `describeToolActivity` over `btw_activity`) —
   * never the chat's, whose run is a different process. Until the child reports
   * one the turn is still working, which is all the panel can honestly say.
   */
  const liveVerb = live?.activity || (runningTopicId ? PHASE_VERBS.sideQuestion : undefined);

  const selectNewest = useCallback(
    (next: BtwState | null) => {
      if (!next) return;
      setSelectedTopicId(next.topics[next.topics.length - 1]?.id ?? null);
    },
    [setSelectedTopicId],
  );

  // `/btw [question]` hands the question over; a bare `/btw` only opens the
  // form, which is the history view.
  useKabmoEvent('omp:btw', (event) => {
    const detail = (event as CustomEvent<{ question?: string; attachments?: Attachment[] }>).detail;
    const question = detail?.question?.trim();
    setOpen(true);
    if (question || detail?.attachments?.length) {
      setAskDraft('');
      void session.ask(question || ATTACHMENT_ONLY_QUESTION, detail?.attachments).then(selectNewest);
    }
  });

  const submitAsk = useCallback(() => {
    const question = askDraft.trim();
    if (!question) return;
    setAskDraft('');
    void session.ask(question).then(selectNewest);
  }, [askDraft, session, setAskDraft, selectNewest]);

  const submitFollowUp = useCallback(
    (question: string, attachments?: Attachment[]) => {
      const text = question.trim();
      if (!text && !attachments?.length) return;
      setFollowUpDraft('');
      // With no topic in view yet, the side session's first question is the
      // topic — there is nothing to follow up on.
      void session.ask(text || ATTACHMENT_ONLY_QUESTION, attachments, activeTopic?.id).then((next) => {
        if (!activeTopic) selectNewest(next);
      });
    },
    [activeTopic, session, setFollowUpDraft, selectNewest],
  );

  const promote = useCallback(async () => {
    if (!activeTopic) return null;
    const created = await session.promote(activeTopic.id);
    if (!created) return null;
    setOpen(false);
    setSelectedTopicId(null);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('sessionId', created);
      if (next.has('subagent')) next.delete('subagent');
      return next;
    });
    return created;
  }, [activeTopic, session, setOpen, setSelectedTopicId, setSearchParams]);

  const removeTopic = useCallback(
    (topicId: string) => {
      if (topicId === selectedTopicId) setSelectedTopicId(null);
      void session.remove(topicId);
    },
    [selectedTopicId, session, setSelectedTopicId],
  );

  return {
    open,
    topics,
    activeTopic,
    runningTopicId,
    busy: session.busy,
    liveMessages: live ? live.messages : [],
    liveVerb,
    error: session.error,
    askDraft,
    followUpDraft,
    setAskDraft,
    setFollowUpDraft,
    enter: () => setOpen(true),
    exit: () => setOpen(false),
    resetQuestion: () => {
      setAskDraft('');
      setSelectedTopicId(null);
      session.clearError();
    },
    submitAsk,
    submitFollowUp,
    // Escape (and the composer's Stop) cancel the turn BEFORE leaving: omp's
    // Escape handler cancels a running answer and only then closes the panel, so
    // a stray keypress cannot abandon a question mid-flight.
    abort: () => {
      if (!runningTopicId) return false;
      void session.abort(runningTopicId);
      return true;
    },
    promote,
    removeTopic,
    selectTopic: (topicId: string) => {
      setSelectedTopicId(topicId);
      session.clearError();
    },
    clearError: session.clearError,
  };
}
