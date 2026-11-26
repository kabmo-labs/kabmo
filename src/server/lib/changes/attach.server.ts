/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Attach a change journal to a live session.
 *
 * The subscription is the RAW frame stream when the transport has one: omp's
 * `bash` trace is stripped before ordinary subscribers see it (it is ~a second
 * copy of the output), and the trace is the only structured record of what a
 * shell command ran. A transport without a raw stream (ACP) falls back to
 * `onEvent`; its tool frames still carry `args`, so the tool adapters work and
 * only the shell layer is weaker.
 *
 * The journal is lazy: a session that never calls a tool writes nothing, so a
 * test that spawns a fake child does not touch the developer's real `~/.kabmo`.
 */

import os from 'node:os';
import type { AgentEvent } from '@kabmo-labs/kabmo-omp-rpc-protocol/constants';
import { ChangeJournal } from '@/server/lib/changes/journal.server';
import { ChangeCapture } from '@/server/lib/changes/capture.server';

export interface JournalSession {
  readonly sessionId: string;
  readonly cwd: string;
  onEvent(listener: (event: AgentEvent) => void): () => void;
  onRawEvent?(listener: (event: AgentEvent) => void): () => void;
}

export interface JournalAttachment {
  /** Stop listening; the journal flushes and closes in the background. */
  detach(): void;
  /** Await every in-flight capture and append (tests and shutdown). */
  flush(): Promise<void>;
}

/** Start journaling `session`. */
export function attachChangeJournal(session: JournalSession): JournalAttachment {
  const noop: JournalAttachment = { detach: () => {}, flush: async () => {} };
  if (!session.sessionId) return noop;
  const journal = new ChangeJournal(session.sessionId, session.cwd);
  const capture = new ChangeCapture({ journal, cwd: session.cwd, home: os.homedir() });
  const subscribe = session.onRawEvent ?? session.onEvent;
  // A test double (or a transport that exposes no frame stream) has neither;
  // the journal is an annotation, not a reason to fail a registration.
  if (typeof subscribe !== 'function') return noop;
  const off = subscribe.call(session, (event) => capture.onFrame(event));
  return {
    detach: () => {
      off();
      void capture.flush().finally(() => journal.close());
    },
    flush: () => capture.flush(),
  };
}
