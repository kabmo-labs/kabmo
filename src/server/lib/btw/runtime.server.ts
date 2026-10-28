/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One BTW topic's live side conversation.
 *
 * The side question runs in a second `omp --mode rpc-ui` child that resumes the
 * topic's own transcript — a snapshot of the parent session taken when the
 * topic first asks. That gives the parent's context as real provider messages
 * (no re-prompting it as text, and the parent's prompt-cache prefix survives)
 * and never writes the parent file.
 *
 * The child runs WITHOUT tools (`--no-tools`), the same end state omp's own
 * `/btw` reaches through `runEphemeralTurn`: the side turn answers from the
 * context it already has, never executes a tool, and discards any tool call the
 * model emits anyway. With no tool surface there is no approval gate to park on,
 * so no dialog can reach this child either.
 *
 * Model and thinking selector come from the CHAT (see `retarget`), never from a
 * picker of this panel's own — omp's side turn reads `request.session.model`.
 *
 * The child is disposable by design: history lives in SQLite plus the topic
 * transcript, so an idle reclaim costs a respawn, not the conversation — a
 * follow-up resumes the transcript and still sees every earlier turn.
 *
 * This class owns the process and the frame routing; the rules about what a turn
 * is worth live in `lifecycle.server.ts`.
 */

import { RpcProcess, type RpcFrame } from '@/server/lib/omp/rpc/process';
import { GET_STATE_TIMEOUT_MS, READY_TIMEOUT_MS, type RpcSessionState } from '@/server/lib/omp/rpc/constants';
import { resolveOmpBin } from '@/server/lib/omp/core/cli';
import { buildBtwSpawnArgs, type BtwSpawnSettings } from '@/server/lib/btw/child.server';
import {
  abortSideTurn,
  askSideQuestion,
  handleSideChildExit,
  resetSideIdleTimer,
  settleSideTurn,
  teardownSideChild,
  trackTurnActivity,
  trackTurnMessage,
  type BtwLifecycleHost,
} from '@/server/lib/btw/lifecycle.server';
import { setBtwTopicLeaf, setBtwTopicModel } from '@/server/lib/btw/store.server';
import { createBtwWorkspace, resolveBtwWorkspacePaths, type BtwWorkspace } from '@/server/lib/btw/session-copy.server';
import { finalAnswer, finalStatus } from '@/server/lib/btw/frames';
import type { AgentImage, BtwFrame, BtwLiveTurn, BtwModel, BtwTurnStatus, ChatMessageData } from '@/shared/types';

/** Prompt images, validated by the route before they reach the child. */
export type BtwImages = AgentImage[];

export interface BtwRuntimeContext {
  topicId: string;
  sessionId: string;
  /** Parent session file the topic's transcript was snapshotted from. */
  parentSessionFile: string;
  cwd: string;
  model?: BtwModel;
  thinkingLevel?: string;
}

/** Where the runtime reports what happened. */
export interface BtwRuntimeSink {
  /** One frame for every client watching this session's btw stream. */
  publish(frame: BtwFrame): void;
  /** The session's topics changed — re-read the state and republish it. */
  stateChanged(): void;
}

export class BtwError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'BtwError';
    this.code = code;
  }
}

export class BtwRuntime implements BtwLifecycleHost {
  proc: RpcProcess | null = null;
  private starting: Promise<RpcProcess> | null = null;
  private workspace: BtwWorkspace | null = null;
  idleTimer: NodeJS.Timeout | null = null;
  abortTimer: NodeJS.Timeout | null = null;
  lastIdleReset = 0;
  turnIndex: number | null = null;
  settling = false;
  /** The turn's conversation so far (chat-shaped; see `trackTurnMessage`). */
  messages: ChatMessageData[] = [];
  /** Last activity phrase published, so repeats are not re-published. */
  activity = '';
  disposing: Promise<void> | null = null;
  /** Model the live child reports, so a retarget only sends a real change. */
  private reportedModel: { provider: string; id: string } | null = null;
  /** Thinking selector the live child reports (`auto` included). */
  private reportedThinkingLevel: string | null = null;

  constructor(
    private readonly context: BtwRuntimeContext,
    readonly sink: BtwRuntimeSink,
  ) {}

  get topicId(): string {
    return this.context.topicId;
  }

  get sessionId(): string {
    return this.context.sessionId;
  }

  /** A question is in flight in this topic. */
  get running(): boolean {
    return this.turnIndex !== null;
  }

  /** True from the moment a turn starts settling until its row is written:
   *  the state repair must treat this topic as live, or it would overwrite the
   *  turn's own status with `interrupted`. */
  get busy(): boolean {
    return this.settling;
  }

  /** The in-flight turn as the server has accumulated it, for `btw_state`. */
  liveTurn(): BtwLiveTurn | null {
    if (this.turnIndex === null) return null;
    return {
      topicId: this.topicId,
      turnIndex: this.turnIndex,
      messages: this.messages,
      activity: this.activity,
    };
  }

  ask(question: string, images?: BtwImages): Promise<void> {
    return askSideQuestion(this, question, images);
  }

  abort(): Promise<void> {
    return abortSideTurn(this);
  }

  /**
   * Adopt the chat's current model and thinking selector before a question is
   * asked. omp's side turn reads `request.session.model` at run time, so a chat
   * that switched model or level is mirrored here — a live child is re-targeted
   * over RPC (`set_model` / `set_thinking_level` apply to the running session),
   * and a cold one simply spawns with these values.
   */
  async retarget(model: BtwModel | undefined, thinkingLevel: string | undefined): Promise<void> {
    this.context.model = model;
    this.context.thinkingLevel = thinkingLevel;
    const proc = this.proc;
    if (!proc?.isAlive) return;
    if (model && (this.reportedModel?.provider !== model.provider || this.reportedModel.id !== model.id)) {
      await proc.sendCommand({ type: 'set_model', provider: model.provider, modelId: model.id }, GET_STATE_TIMEOUT_MS);
      // Remember what was sent: without this the next question re-sends the same
      // pair, because `reportedModel` would still hold the spawn-time value.
      this.reportedModel = { provider: model.provider, id: model.id };
    }
    if (thinkingLevel && thinkingLevel !== this.reportedThinkingLevel) {
      await proc.sendCommand({ type: 'set_thinking_level', level: thinkingLevel }, GET_STATE_TIMEOUT_MS);
      this.reportedThinkingLevel = thinkingLevel;
    }
  }

  /** Reclaim the child; the topic's history survives in SQLite and on disk. */
  async dispose(): Promise<void> {
    if (this.disposing) return this.disposing;
    if (this.running) {
      // A turn would die with the child — settle it rather than lose the answer.
      await settleSideTurn(this, 'cancelled');
    }
    this.disposing = this.teardownChild();
    return this.disposing;
  }

  async teardownChild(): Promise<void> {
    await teardownSideChild(this);
  }

  private ensureWorkspace(): Promise<BtwWorkspace> {
    if (this.workspace) return Promise.resolve(this.workspace);
    return this.openWorkspace();
  }

  /** The topic's transcript: created from the parent on first use, resumed
   *  afterwards so a respawn continues the same side conversation. */
  private async openWorkspace(): Promise<BtwWorkspace> {
    const paths = await resolveBtwWorkspacePaths(this.context.sessionId, this.context.topicId);
    const existing = await Bun.file(paths.sessionFile).exists();
    if (existing) {
      this.workspace = { ...paths, leafId: null };
      return this.workspace;
    }
    const workspace = await createBtwWorkspace({
      parentSessionId: this.context.sessionId,
      topicId: this.context.topicId,
      parentSessionFile: this.context.parentSessionFile,
    });
    // The snapshot's leaf is the promotion guard's baseline: the branch may only
    // be cut while the parent still ENDS at the entry this copy was taken from.
    // Written here, where the snapshot is actually taken, because a later
    // transcript cannot reconstruct which entry that was.
    if (workspace.leafId) await setBtwTopicLeaf(this.context.topicId, workspace.leafId);
    this.workspace = workspace;
    return workspace;
  }

  start(): Promise<RpcProcess> {
    // Reuse the live child. Without this guard every question spawns ANOTHER
    // `omp --resume` for the same topic and abandons the previous one — measured:
    // two live children with the same transcript, the older one holding the
    // pre-retarget `--model`, both appending to the same file. A child that died
    // (`proc` nulled by `handleSideChildExit`) still gets a fresh spawn.
    if (this.proc?.isAlive) return Promise.resolve(this.proc);
    if (this.starting) return this.starting;
    const started = this.spawnChild();
    this.starting = started;
    void started
      .catch(() => {})
      .finally(() => {
        if (this.starting === started) this.starting = null;
      });
    return started;
  }

  private async spawnChild(): Promise<RpcProcess> {
    const bin = resolveOmpBin();
    if (!bin) throw new BtwError('The omp binary could not be found.', 'btw_unavailable');
    const workspace = await this.ensureWorkspace();
    const settings: BtwSpawnSettings = {
      model: this.context.model,
      thinkingLevel: this.context.thinkingLevel,
    };
    const proc = new RpcProcess({
      cwd: this.context.cwd,
      extraArgs: buildBtwSpawnArgs(workspace.sessionFile, settings),
      onFrame: (frame) => this.handleFrame(frame),
      onExit: (info) => handleSideChildExit(this, info.stderrTail),
    });
    this.proc = proc;
    this.reportedModel = null;
    this.reportedThinkingLevel = null;
    const ready = await proc.waitReady(READY_TIMEOUT_MS);
    await proc.negotiateProtocol(ready);
    await this.captureModel(proc);
    return proc;
  }

  /**
   * Record what the child reports about itself: the display name of the model
   * it resolved (for the run footer) and the model/selector it runs with, so a
   * `retarget` before the next question only sends a real change.
   *
   * The THINKING LEVEL is NOT written back to the topic. `get_state` reports the
   * level the child RESOLVED (an `auto` chat resolves to a concrete effort), and
   * storing that would pin every later spawn to it — the side conversation would
   * stop re-classifying per turn while the chat it mirrors keeps doing so. The
   * chat's own recorded selector is what each ask reads instead.
   */
  private async captureModel(proc: RpcProcess): Promise<void> {
    try {
      const state = await proc.sendCommand<RpcSessionState>({ type: 'get_state' }, GET_STATE_TIMEOUT_MS);
      const reported = state.model;
      if (reported?.provider && reported.id) {
        this.reportedModel = { provider: reported.provider, id: reported.id };
        if (reported.name) {
          await setBtwTopicModel(this.topicId, { provider: reported.provider, id: reported.id, name: reported.name });
          this.sink.stateChanged();
        }
      }
      if (typeof state.thinkingLevel === 'string' && state.thinkingLevel) {
        this.reportedThinkingLevel = state.thinkingLevel;
      }
    } catch {
      // A chip without a display name is cosmetic; the topic keeps its model.
    }
  }

  private handleFrame(frame: RpcFrame): void {
    if (frame.type === 'message_update' || frame.type === 'message_start') {
      // The turn's conversation is accumulated in the chat's own shape (see
      // `trackTurnMessage`): thinking, prose and usage reach the panel through
      // the same mapper the chat timeline uses.
      trackTurnMessage(this, frame);
      trackTurnActivity(this, frame);
    } else if (frame.type === 'message_end') {
      // The completed message is the authoritative copy: it carries the turn's
      // real usage, where the streaming frames report zeros, and its thinking is
      // no longer generating. Upserting it replaces the streaming row in place
      // (same message id), which is what puts token counts on the run footer
      // without leaving a pulsing accordion behind on the next reload.
      trackTurnMessage(this, frame, false);
    } else if (frame.type === 'agent_end') {
      // `isTerminal: false` means maintenance scheduled more work; the turn is
      // not done until a terminal end arrives (mirrors the session wrapper).
      if (frame.isTerminal === false) return;
      void settleSideTurn(this, finalStatus(frame.messages), finalAnswer(frame.messages, ''));
    }
    resetSideIdleTimer(this);
  }
}

export type { BtwTurnStatus };
