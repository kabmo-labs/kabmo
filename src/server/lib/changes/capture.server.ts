/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Turn a session's live frames into journal records.
 *
 * Three capture layers, in order of authority:
 *
 *   1. **tool adapter** — `edit`/`write`/`ast_edit`/native edit ops name their
 *      path in `args`, so the before/after pair is exact.
 *   2. **shell trace** — a `bash` call's `details.trace` gives one `simple`
 *      node per command with `argv` and exit status. The classifier reads it,
 *      and the script text (tokenized at start) supplies the redirects the
 *      trace does not model.
 *   3. **git scan** — an opaque command (`git reset --hard`, an install, a
 *      script) is reconciled from a `git status` snapshot before and after.
 *      A command the scan cannot cover is a `note`, never a guess.
 *
 * The before snapshot is taken at `tool_execution_start`, before the tool runs.
 * The frame is emitted by the child before it executes, so the read usually
 * wins; when it does not, an `edit` is reconstructed from `old_string`/
 * `new_string` (the tool's own replacement), and a `write` whose content is
 * already on disk is left alone rather than journaled as a no-op.
 *
 * The trace is read BEFORE the first `await` in `#end`: `EventFanout` strips it
 * from the frame in place right after the raw listeners return.
 */

import path from 'node:path';
import { isRecord } from '@/shared/lib/util/guards';
import type { AgentEvent } from '@/server/lib/omp/rpc/constants';
import { classifyCommand } from '@/server/lib/changes/classify-command';
import { captureBashChanges, type BashCaptureHost } from '@/server/lib/changes/capture-bash.server';
import {
  defaultReadFile,
  defaultStatFile,
  displayPathFor,
  extractTrace,
  MUTATING_TOOL,
  SCAN_COMMAND,
} from '@/server/lib/changes/capture-fs.server';
import type {
  CaptureDeps,
  ChangeExtra,
  ChangeSource,
  PendingCall,
  ShellTrace,
} from '@/server/lib/changes/capture-types';
import { readHeadContent, takeScan, type GitScan } from '@/server/lib/changes/scan.server';
import { reconstructEdit, resolveRacedWrite } from '@/server/lib/changes/capture-write.server';
import { MAX_BLOB_BYTES } from '@/server/lib/changes/blobs.server';

export class ChangeCapture {
  readonly #pending = new Map<string, PendingCall>();
  readonly #tasks = new Set<Promise<void>>();
  readonly #readFile: (absolute: string) => Promise<string | null>;
  readonly #statFile: (absolute: string) => Promise<{ mtimeMs: number; size: number; birthtimeMs: number } | null>;
  readonly #takeScan: (cwd: string) => Promise<GitScan | null>;
  readonly #readHead: (root: string, absolute: string) => Promise<string | null>;
  /** The open run; kept after a terminal end so a late subagent keeps its id. */
  #runId: string | null = null;
  #runAt = 0;
  #runClosed = false;

  constructor(private readonly deps: CaptureDeps) {
    this.#readFile = deps.readFile ?? defaultReadFile;
    this.#statFile = deps.statFile ?? defaultStatFile;
    this.#takeScan = deps.takeScan ?? takeScan;
    this.#readHead = deps.readHead ?? readHeadContent;
  }

  onFrame(event: AgentEvent): void {
    switch (event.type) {
      case 'agent_start':
        this.#openRun();
        break;
      case 'agent_end':
        this.#closeRun(event);
        break;
      case 'tool_execution_start':
        this.#track(this.#start(event));
        break;
      case 'tool_execution_end':
        this.#track(this.#end(event));
        break;
      case 'subagent_event':
        this.#subagent(event);
        break;
    }
  }

  /** Await every in-flight capture and the journal's own append chain. */
  async flush(): Promise<void> {
    await Promise.all([...this.#tasks]);
    await this.deps.journal.flush();
  }

  #track(task: Promise<void>): void {
    this.#tasks.add(task);
    void task.finally(() => this.#tasks.delete(task));
  }

  /**
   * A new run opens on `agent_start` unless one is already open. A retry or a
   * continuation re-enters `agent_start` without a terminal `agent_end`, and
   * that is the SAME run — a new id there would split one run's files in two.
   */
  #openRun(): void {
    if (this.#runId !== null && !this.#runClosed) return;
    this.#runId = `r-${Bun.randomUUIDv7()}`;
    this.#runAt = Date.now();
    this.#runClosed = false;
    void this.deps.journal.recordRun({ at: this.#runAt, phase: 'start', runId: this.#runId });
  }

  /**
   * Only a TERMINAL `agent_end` closes the run. omp emits a non-terminal one
   * when an async subagent is still working; closing there would put the
   * subagent's later writes in the next run. The id is deliberately NOT
   * cleared: a change that lands after the end still belongs to this run.
   */
  #closeRun(event: AgentEvent): void {
    if (event.isTerminal === false) return;
    if (this.#runId === null || this.#runClosed) return;
    this.#runClosed = true;
    void this.deps.journal.recordRun({ at: Date.now(), phase: 'end', runId: this.#runId });
  }

  async #start(event: AgentEvent): Promise<void> {
    const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : '';
    if (!toolCallId) return;
    const tool = typeof event.toolName === 'string' ? event.toolName : 'unknown';
    const args = isRecord(event.args) ? event.args : {};
    const agent = typeof event.agent === 'string' ? event.agent : 'Main';
    const parent = typeof event.parent === 'string' ? event.parent : undefined;
    const runId = this.#runId ?? undefined;
    const runAt = this.#runId !== null ? this.#runAt : undefined;
    const pending: PendingCall = {
      toolCallId,
      ...(runId ? { runId, runAt } : {}),
      tool,
      agent,
      ...(parent ? { parent } : {}),
      startedAt: Date.now(),
      args,
      before: new Map(),
      ready: Promise.resolve(),
    };
    this.#pending.set(toolCallId, pending);
    void this.deps.journal.recordCall({
      at: pending.startedAt,
      ...(runId ? { runId, runAt } : {}),
      toolCallId,
      agent,
      ...(parent ? { parent } : {}),
      tool,
      ...(typeof event.intent === 'string' ? { intent: event.intent } : {}),
      args,
    });
    pending.ready = this.#snapshotBefore(pending);
  }

  async #snapshotBefore(pending: PendingCall): Promise<void> {
    if (pending.tool === 'bash') {
      const command = typeof pending.args.command === 'string' ? pending.args.command : '';
      pending.command = command;
      pending.plan = classifyCommand(command, this.deps.cwd, this.deps.home);
      if (pending.plan.opaque && SCAN_COMMAND.test(command)) {
        pending.scan = await this.#takeScan(this.deps.cwd);
      }
    }
    for (const absolute of this.#targets(pending)) {
      if (pending.before.has(absolute)) continue;
      const info = await this.#statFile(absolute);
      const text = await this.#readCapped(absolute);
      pending.before.set(absolute, { text, ...(info ? { mtimeMs: info.mtimeMs } : {}) });
    }
  }

  #targets(pending: PendingCall): string[] {
    if (pending.tool === 'bash') {
      const paths: string[] = [];
      for (const mutation of pending.plan?.mutations ?? []) {
        paths.push(mutation.path);
        if (mutation.from) paths.push(mutation.from);
      }
      return paths;
    }
    const args = pending.args;
    const raw: unknown[] = [args.path, args.file_path, args.moveTo, args.destination];
    if (Array.isArray(args.paths)) raw.push(...args.paths);
    if (Array.isArray(args.files)) raw.push(...args.files);
    const paths: string[] = [];
    for (const value of raw) {
      if (typeof value !== 'string' || !value || value.includes('://')) continue;
      paths.push(path.isAbsolute(value) ? path.normalize(value) : path.resolve(this.deps.cwd, value));
    }
    return paths;
  }

  async #end(event: AgentEvent): Promise<void> {
    const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : '';
    if (!toolCallId) return;
    const pending = this.#pending.get(toolCallId);
    if (!pending) return;
    this.#pending.delete(toolCallId);
    // Read the trace BEFORE the first await: `EventFanout` strips it from the
    // frame in place right after the raw listeners return, and this function
    // resumes later.
    const trace = extractTrace(event);
    await pending.ready;
    if (pending.tool === 'bash') await this.#endBash(pending, trace);
    else await this.#endFileTool(pending);
  }

  async #endFileTool(pending: PendingCall): Promise<void> {
    const targets = this.#targets(pending);
    if (targets.length === 0) {
      // A read-only tool (`read`, `glob`, `grep`) has no adapter and no
      // mutation; only a tool whose NAME promises a write is worth a note.
      if (MUTATING_TOOL.test(pending.tool)) {
        await this.deps.journal.recordNote({
          at: Date.now(),
          ...(pending.runId ? { runId: pending.runId, runAt: pending.runAt } : {}),
          toolCallId: pending.toolCallId,
          reason: 'unknown-tool',
          detail: pending.tool,
        });
      }
      return;
    }
    for (const absolute of targets) {
      const entry = pending.before.get(absolute);
      const before = entry ? entry.text : null;
      const after = await this.#readCapped(absolute);
      if (before === after) {
        const reconstructed = reconstructEdit(pending, after);
        if (reconstructed !== null) {
          await this.#writeChange(pending, absolute, reconstructed, after, 'tool');
          continue;
        }
        // A `write` whose snapshot raced the tool: omp's own journal read the
        // file before the write, so its `before` is exact. Without it, record
        // the change with an unknown before rather than dropping the file.
        if (pending.tool === 'write' && typeof pending.args.content === 'string' && after === pending.args.content) {
          const raced = await resolveRacedWrite(pending, absolute, {
            sessionId: this.deps.journal.sessionId,
            statFile: this.#statFile,
          });
          await this.#writeChange(
            pending,
            absolute,
            raced.before,
            after,
            'tool',
            raced.reason ? { unavailableReason: raced.reason } : {},
          );
        }
        continue;
      }
      await this.#writeChange(pending, absolute, before, after, 'tool');
    }
  }

  /** Read a file unless it is over the blob cap; `undefined` means not stored. */
  async #readCapped(absolute: string): Promise<string | null | undefined> {
    const info = await this.#statFile(absolute);
    if (info && info.size > MAX_BLOB_BYTES) return undefined;
    return this.#readFile(absolute);
  }

  async #endBash(pending: PendingCall, trace: ShellTrace | null): Promise<void> {
    const host: BashCaptureHost = {
      cwd: this.deps.cwd,
      home: this.deps.home,
      readFile: (absolute) => this.#readCapped(absolute),
      statFile: this.#statFile,
      takeScan: this.#takeScan,
      readHead: this.#readHead,
      writeChange: (call, absolute, before, after, source, extra) =>
        this.#writeChange(call, absolute, before, after, source, extra),
      note: (call, reason, detail) =>
        this.deps.journal.recordNote({
          at: Date.now(),
          ...(call.runId ? { runId: call.runId, runAt: call.runAt } : {}),
          toolCallId: call.toolCallId,
          reason,
          ...(detail ? { detail } : {}),
        }),
    };
    await captureBashChanges(pending, trace, host);
  }

  async #writeChange(
    pending: PendingCall,
    absolute: string,
    before: string | null | undefined,
    after: string | null | undefined,
    source: ChangeSource,
    extra: ChangeExtra = {},
  ): Promise<void> {
    // Two unknown sides are not proof of no change; only two known equal sides are.
    if (before === after && before !== undefined) return;
    const op = before === null ? 'create' : after === null ? 'delete' : 'update';
    const beforeInfo = pending.before.get(absolute);
    const afterInfo = await this.#statFile(absolute);
    await this.deps.journal.recordChange({
      at: Date.now(),
      ...(pending.runId ? { runId: pending.runId, runAt: pending.runAt } : {}),
      toolCallId: pending.toolCallId,
      agent: pending.agent,
      ...(pending.parent ? { parent: pending.parent } : {}),
      tool: pending.tool,
      op,
      path: absolute,
      ...(extra.from ? { from: extra.from } : {}),
      displayPath: displayPathFor(absolute, this.deps.cwd),
      before,
      after,
      ...(beforeInfo?.mtimeMs !== undefined ? { beforeMtimeMs: beforeInfo.mtimeMs } : {}),
      ...(afterInfo ? { afterMtimeMs: afterInfo.mtimeMs } : {}),
      source,
      ...(extra.command ? { command: extra.command } : {}),
      ...(extra.exit !== undefined ? { exit: extra.exit } : {}),
      ...(extra.unavailableReason ? { unavailableReason: extra.unavailableReason } : {}),
    });
  }

  #subagent(event: AgentEvent): void {
    const payload = event.payload;
    if (!isRecord(payload)) return;
    const frame = isRecord(payload.data) && typeof payload.data.type === 'string' ? payload.data : payload;
    const type = frame.type;
    if (type !== 'tool_execution_start' && type !== 'tool_execution_end') return;
    const agent = typeof payload.agent === 'string'
      ? payload.agent
      : typeof payload.subagentId === 'string'
        ? payload.subagentId
        : 'Subagent';
    const parent = typeof payload.parent === 'string' ? payload.parent : undefined;
    this.onFrame({ ...frame, type, agent, ...(parent ? { parent } : {}) });
  }
}
