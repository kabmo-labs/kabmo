/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The ACP session stubs the session suites drive.
 *
 * Extracted because the per-concern suites (`session.test.ts`,
 * `session-permissions.test.ts`, `session-observers.test.ts`) each need the same
 * turn harness, and a second copy is exactly how two files drift into asserting
 * different behaviour of one seam.
 *
 * The session is built on `AcpSession.prototype` rather than through the
 * constructor: the constructor spawns a real agent process, and every rule below
 * is about what the session does with frames and commands, not about ACP
 * transport. The seams a case may stub are the ones the class exposes for it
 * (`markStream`, `onNotification`, `onClientRequest`, `proc`).
 */

import { AcpSession } from '@/server/lib/harness/acp/session';
import { AcpUsageMeter } from '@/server/lib/harness/acp/session-usage';
import { AcpFrameMapper } from '@/server/lib/harness/acp/frames';
import { AcpTurns } from '@/server/lib/harness/acp/turn';
import { PendingPermissions } from '@/server/lib/harness/acp/permissions';
import type { AgentEvent } from '@/server/lib/omp/rpc/constants';

export interface Turn {
  /** Resolves once `session/prompt` has actually been sent. The dispatch is
   *  chained behind the previous turn's request, so it is one tick later than
   *  the ACK and every assertion has to wait for it. */
  started: Promise<void>;
  /** How many `session/prompt` requests have been sent. */
  calls: () => number;
  /** Settle the pending `session/prompt` call. */
  finish: (result: { stopReason?: string }) => void;
  fail: (error: unknown) => void;
}

export interface MountedSession {
  session: AcpSession;
  events: AgentEvent[];
  turn: Turn;
  /** How many times the turn-end seam fired (the queue's arming hook). */
  turnEnds: () => number;
  /** The durable run markers written for this session, in order. */
  streamMarks: () => string[];
  /** How many times a command or frame deferred the idle reclaim. */
  idleResets: () => number;
  /** Whether a destroy stopped the reclaim clock. */
  idleStopped: () => boolean;
}

/** One in-flight `session/prompt` the stub can settle. */
interface PendingPrompt {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

export function mountSession(): MountedSession {
  const events: AgentEvent[] = [];
  const dispatched = Promise.withResolvers<void>();
  const calls: PendingPrompt[] = [];
  const turn: Turn = {
    started: dispatched.promise,
    calls: () => calls.length,
    finish: (result) => calls.at(-1)?.resolve(result),
    fail: (error) => calls.at(-1)?.reject(error),
  };

  const session = Object.create(AcpSession.prototype) as AcpSession;
  const mapper = new AcpFrameMapper();
  let turnEndCount = 0;
  let idleResets = 0;
  let idleStopped = false;
  const idle = {
    timeoutMs: 0,
    reset: () => {
      idleResets += 1;
    },
    stop: () => {
      idleStopped = true;
    },
  };
  const proc = {
    prompt: async (_message: string, _images: unknown) => {
      const pending = Promise.withResolvers<unknown>();
      calls.push(pending);
      dispatched.resolve();
      return pending.promise;
    },
    cancel: () => {},
    abandonPrompt: () => calls.at(-1)?.resolve({ stopReason: 'cancelled' }),
    dispose: async () => {},
    isAlive: true,
  };
  const turns = new AcpTurns({
    emit: (event) => (session as unknown as { emit: (e: AgentEvent) => void }).emit(event),
    prompt: (message, images) => proc.prompt(message, images) as Promise<{ stopReason?: string } | undefined>,
    cancelAgent: () => proc.cancel(),
    abandonPrompt: () => proc.abandonPrompt(),
    resetMapper: () => mapper.reset(),
    closeMessage: () => mapper.closeMessage(),
    openCalls: () => mapper.openCalls(),
    onTurnEnd: (info) => {
      (session as unknown as { onTurnEnded: (info: { stopReason?: string; closedMessage: boolean }) => void })
        .onTurnEnded(info);
      turnEndCount += 1;
    },
  });
  const marks: string[] = [];
  Object.assign(session as unknown as Record<string, unknown>, {
    markStream: (status: string) => {
      marks.push(status);
    },
    harness: 'opencode',
    cwd: '/tmp',
    sessionId: 'acp-1',
    turns,
    mapper,
    permissions: new PendingPermissions(),
    accessMode: 'always-ask',
    capabilities: {},
    configOptions: [],
    agentCommands: [],
    planEntries: [],
    messageCount: 0,
    promptCount: 0,
    assistantCount: 0,
    usage: new AcpUsageMeter(),
    runModel: null,
    listeners: new Set<(event: AgentEvent) => void>([(event) => events.push(event)]),
    proc,
    idle,
    destroyed: false,
  });
  return {
    session,
    events,
    turn,
    turnEnds: () => turnEndCount,
    streamMarks: () => marks,
    idleResets: () => idleResets,
    idleStopped: () => idleStopped,
  };
}

/** Push one `session/update` at the session, as the process would. */
export function notify(session: AcpSession, update: Record<string, unknown>): void {
  (session as unknown as { onNotification: (method: string, params: unknown) => void }).onNotification.call(
    session,
    'session/update',
    { update },
  );
}
