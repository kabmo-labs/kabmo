/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The text Kabmo itself injects into a transcript, and the one parser both ends
 * read it with.
 *
 * Three prompts in a session are written by Kabmo, not by a human:
 *
 * - the orchestration contract the composer prepends to a delegating message
 *   (`formatDelegationPrompt`),
 * - the dispatched-worker brief a spawned child opens with
 *   (`dispatchedWorkerPrompt`),
 * - the child-outcome notice a finishing worker sends its coordinator
 *   (`renderChildOutcomeNotice`).
 *
 * All three travel as ordinary prompts, so omp stores them as `role: "user"`
 * turns and the timeline drew them as the operator's own bubbles — a 1 KB
 * contract, a shell heredoc and a worker report, indistinguishable from
 * something a person typed. The envelope below is what makes them
 * recognizable: the server writes it, the client parses it, and the timeline
 * renders a card instead of a bubble.
 *
 * The envelope is also the FORMAT: a bracketed marker survives omp's JSONL
 * round trip untouched (unlike a `customType`, which only a `custom_message`
 * carries), and it reads as a labelled block to the model that consumes it.
 */

/** Envelope markers. One pair per injected prompt; the closing tag repeats the
 *  opening name so a truncated body is still attributable. */
export const ORCHESTRATION_CONTRACT = {
  open: '[kabmo orchestration contract]',
  close: '[/kabmo orchestration contract]',
} as const;

export const WORKER_BRIEF = {
  open: '[kabmo dispatched worker]',
  close: '[/kabmo dispatched worker]',
} as const;

export const CHILD_OUTCOME = {
  open: '[kabmo child outcome]',
  close: '[/kabmo child outcome]',
} as const;

export type OrchestrationKind = 'contract' | 'worker' | 'outcome';

export interface OrchestrationBlock {
  kind: OrchestrationKind;
  /** The text between the markers — the injected instruction itself. */
  body: string;
  /** What followed the closing marker: the operator's own words, when the
   *  contract was prepended to a message they typed. Empty for a notice. */
  rest: string;
}

const ENVELOPES: readonly { kind: OrchestrationKind; open: string; close: string }[] = [
  { kind: 'contract', ...ORCHESTRATION_CONTRACT },
  { kind: 'worker', ...WORKER_BRIEF },
  { kind: 'outcome', ...CHILD_OUTCOME },
];

/**
 * Split a user turn into the injected block and the operator's own text.
 *
 * Returns null for anything a human wrote, so the caller keeps the ordinary
 * bubble. A block whose closing marker is missing is NOT an envelope: a
 * half-written marker is prose, and guessing would swallow the rest of the
 * message.
 */
export function parseOrchestrationBlock(content: string): OrchestrationBlock | null {
  const text = content.trimStart();
  for (const envelope of ENVELOPES) {
    if (!text.startsWith(envelope.open)) continue;
    const closeAt = text.indexOf(envelope.close, envelope.open.length);
    if (closeAt === -1) return null;
    return {
      kind: envelope.kind,
      body: text.slice(envelope.open.length, closeAt).trim(),
      rest: text.slice(closeAt + envelope.close.length).trim(),
    };
  }
  return null;
}

/** One worker's outcome, as the notice carries it. */
export interface ChildOutcomeEntry {
  sessionId: string;
  title?: string | null;
  status: 'completed' | 'failed' | 'interrupted';
  /** The child's final assistant text, already excerpted by the caller. */
  output?: string | null;
  /** Why it failed or was interrupted, when known. */
  failure?: string | null;
}

/** Separator between two workers in one notice. */
const ENTRY_SEPARATOR = '\n---\n';

/** Longest reason line carried into the notice. A provider error can be a
 *  multi-kilobyte HTML page; the coordinator needs the first sentence. */
const MAX_REASON_CHARS = 600;

function reasonOf(entry: ChildOutcomeEntry): string {
  const reason = (entry.failure ?? '').replace(/\s+/g, ' ').trim();
  if (!reason) return entry.status === 'interrupted' ? 'The run was interrupted.' : 'The run failed.';
  return reason.length <= MAX_REASON_CHARS ? reason : `${reason.slice(0, MAX_REASON_CHARS - 1)}…`;
}

function renderEntry(entry: ChildOutcomeEntry): string {
  const lines = [`session: ${entry.sessionId}`, `status: ${entry.status}`];
  const title = entry.title?.trim();
  if (title) lines.push(`title: ${title.replace(/\s+/g, ' ').trim()}`);
  if (entry.status === 'completed') {
    lines.push('output:', entry.output?.trim() || 'No final output was recorded.');
    return lines.join('\n');
  }
  lines.push(`reason: ${reasonOf(entry)}`);
  // The coordinator's next move, stated once per failed worker: a report that
  // only says "failed" invites a resend of the same task, which is how one
  // broken worker became a loop. No `kabmo session output` pointer here — a
  // failed run has no assistant answer to print, so the reason above IS the
  // detail, and pointing at an empty command is a dead end.
  lines.push('next: report this failure to the user instead of resending the task');
  return lines.join('\n');
}

/**
 * The notice body for one worker or a coalesced batch.
 *
 * One envelope, one entry per worker, `---` between them: the coordinator reads
 * a list, and the timeline parses the same text into one card per worker.
 */
export function renderChildOutcomeNotice(items: readonly ChildOutcomeEntry[]): string {
  const body = items.map(renderEntry).join(ENTRY_SEPARATOR);
  return `${CHILD_OUTCOME.open}\n${body}\n${CHILD_OUTCOME.close}`;
}

const STATUSES: Readonly<Record<string, ChildOutcomeEntry['status']>> = {
  completed: 'completed',
  failed: 'failed',
  interrupted: 'interrupted',
};

/**
 * Read a notice body back into entries.
 *
 * Tolerant by design: an unknown status is read as `failed` (a worker whose
 * outcome cannot be classified is not a success), and a chunk with no
 * `session:` line is dropped rather than rendered as a blank card.
 */
export function parseChildOutcomeNotice(body: string): ChildOutcomeEntry[] {
  const entries: ChildOutcomeEntry[] = [];
  for (const chunk of body.split(ENTRY_SEPARATOR)) {
    const lines = chunk.split('\n');
    const fields = new Map<string, string>();
    let output: string | null = null;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] as string;
      const match = /^([a-z]+):\s?(.*)$/.exec(line);
      if (!match) continue;
      const key = match[1] as string;
      if (key === 'output') {
        output = lines.slice(index + 1).join('\n').trim();
        break;
      }
      fields.set(key, (match[2] as string).trim());
    }
    const sessionId = fields.get('session');
    if (!sessionId) continue;
    const status = STATUSES[fields.get('status') ?? ''] ?? 'failed';
    entries.push({
      sessionId,
      status,
      ...(fields.get('title') ? { title: fields.get('title') as string } : {}),
      ...(output !== null ? { output } : {}),
      ...(fields.get('reason') ? { failure: fields.get('reason') as string } : {}),
    });
  }
  return entries;
}
