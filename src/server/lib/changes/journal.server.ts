/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Kabmo change journal writer: one append-only JSONL per session.
 *
 * Every append goes through one promise chain, so two parallel subagents cannot
 * interleave a half line. A failed append is logged and swallowed — the journal
 * is an annotation on a run, and a full disk must not kill the run it reports
 * on. A torn final line is tolerated by the reader, the same rule omp's own
 * journal follows.
 *
 * The directory is created lazily, on the first record: a session that never
 * calls a tool writes nothing, which is what keeps a test that spawns a fake
 * child from touching the developer's real `~/.kabmo`.
 *
 * Rotation: when the journal passes 20 MB it is renamed to
 * `changes.<epoch>.jsonl` and a fresh `changes.jsonl` starts with a new header.
 * The reader reads every `changes*.jsonl` in name order, so a rotated file is
 * older than the current one and the sequence is preserved.
 */

import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { blobsDir, journalPath, sessionChangesDir } from '@/server/lib/changes/paths.server';
import { writeBlob } from '@/server/lib/changes/blobs.server';
import type { MutationOp } from '@/server/lib/changes/classify-command';
import type {
  JournalCallRecord,
  JournalChangeRecord,
  JournalNoteRecord,
  JournalRecord,
  JournalRunRecord,
  JournalSessionRecord,
} from '@/server/lib/changes/records';

const MAX_JOURNAL_BYTES = 20 * 1024 * 1024;
const MAX_ARGS_BYTES = 4 * 1024;

export interface ChangeInput {
  at: number;
  runId?: string;
  runAt?: number;
  toolCallId?: string;
  agent: string;
  parent?: string;
  tool: string;
  op: MutationOp;
  path: string;
  from?: string;
  displayPath: string;
  /** Full text before the write; `null` absent, `undefined` not stored. */
  before: string | null | undefined;
  /** Full text after the write; `null` absent, `undefined` not stored. */
  after: string | null | undefined;
  beforeMtimeMs?: number;
  afterMtimeMs?: number;
  source: JournalChangeRecord['source'];
  command?: string;
  exit?: number;
  /** Why a side is `undefined`; defaults to the blob cap. */
  unavailableReason?: 'too-large' | 'snapshot-race';
}

export class ChangeJournal {
  readonly dir: string;
  readonly #startedAt = Date.now();
  #chain: Promise<void> = Promise.resolve();
  #ready: Promise<void> | null = null;
  #closed = false;
  #bytes = 0;

  constructor(
    readonly sessionId: string,
    readonly cwd: string,
  ) {
    this.dir = sessionChangesDir(sessionId);
  }

  recordCall(input: Omit<JournalCallRecord, 'v' | 'type'>): Promise<void> {
    const args = truncateArgs(input.args);
    return this.#enqueue(() => this.#appendLine({ v: 1, type: 'call', ...input, ...args }));
  }

  recordChange(input: ChangeInput): Promise<void> {
    return this.#enqueue(async () => {
      const before = input.before === null || input.before === undefined
        ? input.before
        : await this.#blob(input.before);
      const after = input.after === null || input.after === undefined
        ? input.after
        : await this.#blob(input.after);
      if (before === undefined || after === undefined) {
        await this.#appendLine({
          v: 1,
          type: 'note',
          at: input.at,
          ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
          reason: input.unavailableReason ?? 'too-large',
          detail: input.path,
        });
      }
      await this.#appendLine({ v: 1, type: 'change', ...input, before, after });
    });
  }

  recordNote(input: Omit<JournalNoteRecord, 'v' | 'type'>): Promise<void> {
    return this.#enqueue(() => this.#appendLine({ v: 1, type: 'note', ...input }));
  }

  recordRun(input: Omit<JournalRunRecord, 'v' | 'type'>): Promise<void> {
    return this.#enqueue(() => this.#appendLine({ v: 1, type: 'run', ...input }));
  }

  flush(): Promise<void> {
    return this.#chain;
  }

  close(): void {
    this.#closed = true;
  }

  #enqueue(task: () => Promise<void>): Promise<void> {
    this.#chain = this.#chain.then(task).catch((error: unknown) => {
      console.error(`[changes] journal append failed for ${this.sessionId}:`, error);
    });
    return this.#chain;
  }

  async #blob(text: string): Promise<string | null | undefined> {
    const key = await writeBlob(blobsDir(this.sessionId), text);
    return key === null ? undefined : key;
  }

  async #appendLine(record: JournalRecord): Promise<void> {
    if (this.#closed) return;
    await this.#ensure();
    const line = `${JSON.stringify(record)}\n`;
    await appendFile(journalPath(this.sessionId), line);
    this.#bytes += Buffer.byteLength(line);
    if (this.#bytes >= MAX_JOURNAL_BYTES) await this.#rotate();
  }

  #ensure(): Promise<void> {
    if (!this.#ready) this.#ready = this.#init();
    return this.#ready;
  }

  async #init(): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await mkdir(blobsDir(this.sessionId), { recursive: true, mode: 0o700 });
    const file = journalPath(this.sessionId);
    const info = await stat(file).catch(() => null);
    this.#bytes = info?.size ?? 0;
    if (!info) await this.#writeHeader(file);
  }

  async #writeHeader(file: string): Promise<void> {
    const header: JournalSessionRecord = {
      v: 1,
      type: 'session',
      at: this.#startedAt,
      sessionId: this.sessionId,
      cwd: this.cwd,
    };
    const line = `${JSON.stringify(header)}\n`;
    await Bun.write(file, line);
    this.#bytes = Buffer.byteLength(line);
  }

  async #rotate(): Promise<void> {
    const file = journalPath(this.sessionId);
    await rename(file, path.join(this.dir, `changes.${Date.now()}.jsonl`));
    await this.#writeHeader(file);
  }
}

function truncateArgs(args: unknown): { args?: unknown; argsTruncated?: boolean } {
  if (args === undefined) return {};
  const json = JSON.stringify(args);
  if (json.length <= MAX_ARGS_BYTES) return { args };
  return { args: json.slice(0, MAX_ARGS_BYTES), argsTruncated: true };
}
