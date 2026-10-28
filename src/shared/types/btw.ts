/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * BTW (side question) domain types.
 *
 * A BTW topic is an independent question plus its explicit follow-ups, run
 * against the parent session's context but never appended to its transcript —
 * the same contract omp's own `/btw` implements in the TUI. The server is the
 * source of truth for a session's topics: each turn's conversation arrives as
 * `btw_message` frames in the chat's own `ChatMessageData` shape, and the
 * running turn is also carried in `BtwState.live` so a client attaching
 * mid-turn renders the answer already produced.
 *
 * A side question runs WITHOUT tools and on the CHAT's model and thinking
 * selector, so there is no per-topic model/access picker and no approval dialog
 * to answer — the panel's composer is an input and a send button, exactly like
 * the TUI's.
 */

import type { ChatMessageData } from '@/shared/types/chat';

/** Lifecycle of one question/answer pair inside a topic. */
export type BtwTurnStatus = 'running' | 'complete' | 'cancelled' | 'error' | 'interrupted';

/** Model a topic's side conversation runs on — the parent session's model,
 *  re-read from the chat's transcript at every ask (omp's `/btw` runs the side
 *  turn on `request.session.model`), so the panel offers no model picker. */
export interface BtwModel {
  provider: string;
  id: string;
  /** Display name reported by the running side session (`DeepSeek-V4.1-Flash`). */
  name?: string;
}

/** One question and its answer inside a topic. */
export interface BtwTurn {
  index: number;
  question: string;
  /** Plain-text answer, kept as the turn's cheap summary (history labels,
   *  promotion titles). The rendered conversation is `messages`. */
  answer: string;
  /**
   * The turn's conversation, in the SAME shape the chat timeline renders
   * (`ChatMessageData`): assistant segments with their thinking, tool calls,
   * usage and errors. Produced by the shared `toChatMessage` mapper, so a side
   * question renders through the chat's own `MessageList` and cannot drift from
   * it — a tool the side child runs is visible here exactly as it would be in
   * the chat.
   */
  messages: ChatMessageData[];
  status: BtwTurnStatus;
  createdAt: number;
  updatedAt: number;
}

/** A side conversation scoped to one Kabmo session. */
export interface BtwTopic {
  id: string;
  sessionId: string;
  /** The first question, used as the topic's label in history. */
  title: string;
  createdAt: number;
  updatedAt: number;
  model?: BtwModel;
  /**
   * Thinking SELECTOR the side child runs at (`auto` included), re-read from the
   * chat's transcript at every ask so a level changed in the chat is mirrored.
   * Undefined when the chat's transcript records none.
   */
  thinkingLevel?: string;
  /** Set once the topic was promoted into the chat as a session of its own. */
  promotedSessionId?: string;
  turns: BtwTurn[];
}

/**
 * The turn streaming right now, as the server has accumulated it.
 *
 * Part of the state rather than only a stream of frames: a client that attaches
 * mid-turn (a reload, a second tab) would otherwise receive a `btw_state` whose
 * running turn still has no persisted messages and would show an empty answer
 * while the child streams on.
 */
export interface BtwLiveTurn {
  topicId: string;
  turnIndex: number;
  /** Chat-shaped conversation so far (thinking and prose). */
  messages: ChatMessageData[];
  /** Activity phrase for the panel's indicator; '' before the child reports one. */
  activity: string;
}

/** A session's whole BTW view. */
export interface BtwState {
  topics: BtwTopic[];
  /** Topic with a question in flight; at most one per session, because a
   *  session runs one side conversation at a time. */
  runningTopicId: string | null;
  /** The running turn's live conversation, or null when nothing is in flight. */
  live: BtwLiveTurn | null;
}

/** Server → client frames on `/api/btw/:sessionId/*` (WS and SSE alike). */
export type BtwFrame =
  | { type: 'connected'; sessionId: string }
  | { type: 'btw_state'; state: BtwState }
  /**
   * One assistant segment of a turn, in the chat's own `ChatMessageData` shape.
   * The client upserts it into `turn.messages` BY `message.id` — the same
   * semantics the chat stream's `onMessageUpdate` uses, because omp emits one
   * frame per segment carrying that segment's full accumulated content.
   */
  | { type: 'btw_message'; topicId: string; turnIndex: number; message: ChatMessageData }
  /**
   * The activity phrase for the panel's indicator, derived from the side
   * child's own frames (`describeAssistantPhase` / `describeToolActivity`) —
   * never from the chat's, whose run is a different process.
   */
  | { type: 'btw_activity'; topicId: string; verb: string }
  | { type: 'btw_error'; topicId: string | null; message: string };
