/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Fan-out for the live subagent frames of one session.
 *
 * The frames already arrive over the unified realtime socket (the
 * `session:<id>` topic), and this is the SECOND hop: the chat fold sees them
 * first and hands them to the surfaces that render a subagent. It is a module
 * bus rather than a window event because the payload is already scoped — the
 * listener filters on the session it was mounted for — and because a window
 * event advertised a contract to the whole page for something only the
 * subagent views consume.
 */

export type SubagentFrameKind = 'subagent_lifecycle' | 'subagent_progress' | 'subagent_event';

export interface SubagentFrame {
  sessionId: string | undefined;
  payload: unknown;
}

type SubagentFrameListener = (frame: SubagentFrame) => void;

const listeners: Record<SubagentFrameKind, Set<SubagentFrameListener>> = {
  subagent_lifecycle: new Set(),
  subagent_progress: new Set(),
  subagent_event: new Set(),
};

/** Subscribe to one kind. Returns the unsubscribe. */
export function subscribeSubagentFrame(kind: SubagentFrameKind, listener: SubagentFrameListener): () => void {
  listeners[kind].add(listener);
  return () => listeners[kind].delete(listener);
}

/**
 * Publish one frame. A throwing listener never stops the others: this sits on
 * the frame fold's path, so it must not be able to break the run it reports on.
 */
export function publishSubagentFrame(kind: SubagentFrameKind, frame: SubagentFrame): void {
  for (const listener of [...listeners[kind]]) {
    try {
      listener(frame);
    } catch {
      // Deliberately swallowed: see the module doc.
    }
  }
}
