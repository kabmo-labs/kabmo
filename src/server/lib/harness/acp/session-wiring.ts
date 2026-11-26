/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The seams an ACP session binds at construction: the turn machine and the
 * background probe.
 *
 * Both are pure wiring over the process and the mapper, and both are the place a
 * reader gets lost inside `session.ts` — the turn machine's `prompt` seam builds
 * the blocks a prompt sends, and the probe's `load` is a `session/load` on the
 * session's OWN id. Naming them here keeps the session class to the state it
 * owns.
 */

import {
  AcpBackgroundProbe,
  BACKGROUND_LOAD_TIMEOUT_MS,
  backgroundPullPrompt,
} from '@/server/lib/harness/acp/background-probe';
import {
  deliverBackgroundNotice,
  type BackgroundNoticeHost,
} from '@/server/lib/harness/acp/background-work';
import type { AcpProcess } from '@kabmo-labs/kabmo-acp-client/client';
import type { AcpFrameMapper } from '@kabmo-labs/kabmo-acp-mapper/frames';
import { promptBlocks } from '@kabmo-labs/kabmo-acp-prompt/prompt';
import { promptFileLinks } from '@kabmo-labs/kabmo-acp-prompt/prompt-files';
import { AcpTurns, type AcpTurnEndInfo } from '@kabmo-labs/kabmo-acp-turn/turn';
import { stampMessageModel } from '@kabmo-labs/kabmo-acp-session-config/session-config';
import type { AgentEvent } from '@/server/lib/omp/rpc/constants';
import type { IdleReaper } from '@kabmo-labs/kabmo-idle-reaper';

/** Everything the two seams read off the session. The counts are the background
 *  notice's alone: it emits one synthetic assistant row and has to move them. */
export interface AcpWiringHost extends BackgroundNoticeHost {
  readonly cwd: string;
  readonly proc: AcpProcess;
  readonly mapper: AcpFrameMapper;
  readonly idle: IdleReaper;
  sessionId: string;
  runModel: { provider: string; modelId: string } | null;
  emit(event: AgentEvent): void;
  onTurnEnded(info: AcpTurnEndInfo): void;
  /** The session's own command surface, for the probe's continuation prompt. */
  send(command: Record<string, unknown>): Promise<unknown>;
  isAlive(): boolean;
}

/** The wiring a session builds for itself.
 *
 *  `sessionId`/`runModel` getters keep the handshake's late assignment visible
 *  to the turn machine. The two COUNTS are accessors in BOTH directions: the
 *  background notice emits a synthetic assistant row and increments them, and a
 *  getter-only property made that throw `Attempted to assign to readonly
 *  property` at the moment the notice was finally delivered — measured against
 *  a real agy chat, after the whole "did the subagent report back" path had
 *  already been exercised for 200 s. */
export function acpWiringFor(session: {
  cwd: string;
  sessionId: string;
  runModel: { provider: string; modelId: string } | null;
  messageCount: number;
  assistantCount: number;
  emit(event: AgentEvent): void;
  onTurnEnded(info: AcpTurnEndInfo): Promise<void>;
  send(command: Record<string, unknown>): Promise<unknown>;
  isAlive(): boolean;
}, parts: { proc: AcpProcess; mapper: AcpFrameMapper; idle: IdleReaper }): AcpWiringHost {
  return {
    cwd: session.cwd,
    proc: parts.proc,
    mapper: parts.mapper,
    idle: parts.idle,
    get sessionId() { return session.sessionId; },
    get runModel() { return session.runModel; },
    get messageCount() { return session.messageCount; },
    set messageCount(count: number) { session.messageCount = count; },
    get assistantCount() { return session.assistantCount; },
    set assistantCount(count: number) { session.assistantCount = count; },
    emit: (event) => session.emit(event),
    onTurnEnded: (info) => void session.onTurnEnded(info),
    send: (command) => session.send(command),
    isAlive: () => session.isAlive(),
  };
}

/** The background probe: ACP holds a subagent's completion until the next
 *  request, and `session/load` is the only request that surfaces it. */
export function acpBackgroundProbe(host: AcpWiringHost): AcpBackgroundProbe {
  return new AcpBackgroundProbe({
    load: () => host.proc.loadSession(host.sessionId, host.cwd, BACKGROUND_LOAD_TIMEOUT_MS),
    resetIdle: () => host.idle.reset(),
    emit: (text) => deliverBackgroundNotice(host, text),
    // `session/load` no longer carries the held completion on antigravity
    // 1.5.3, so the probe asks the agent to resume. The prompt is synthetic:
    // it must not rename the chat, and it is ONE turn per background call.
    pull: async () => {
      if (!host.isAlive()) return;
      await host.send({ type: 'prompt', message: backgroundPullPrompt(), synthetic: true, quiet: true });
      host.emit({
        type: 'notice',
        level: 'info',
        message: 'The background subagent did not report back; continuing automatically.',
      });
    },
  });
}

/** The turn machine: one prompt, its frames, and how it ends. */
export function acpTurns(host: AcpWiringHost): AcpTurns {
  return new AcpTurns({
    emit: (event) => host.emit(event),
    prompt: (message, images) =>
      // `@path` mentions travel as `resource_link` blocks: no agent but omp
      // expands them, and the file would otherwise reach the model as a path
      // with no bytes behind it.
      promptFileLinks(host.cwd, message).then(
        (files) => host.proc.prompt(host.sessionId, promptBlocks(message, images, files), 0) as Promise<{ stopReason?: string } | undefined>,
      ),
    cancelAgent: () => host.proc.cancel(host.sessionId),
    abandonPrompt: () => host.proc.abandonPrompt(host.sessionId),
    resetMapper: () => host.mapper.reset(),
    closeMessage: () => host.mapper.closeMessage().map((event) => stampMessageModel(event, host.runModel)),
    turnMessage: () => host.mapper.turnMessage(),
    openCalls: () => host.mapper.openCalls(),
    // Armed from the turn's END, exactly as the omp wrapper arms it from its own
    // terminal settle: without this a queued follow-up never left the table.
    onTurnEnd: (info) => host.onTurnEnded(info),
  });
}
