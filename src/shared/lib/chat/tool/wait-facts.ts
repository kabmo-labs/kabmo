/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The fact chips for a `wait` call.
 *
 * Split out of `summary.ts`, which is at the repo's per-file ceiling, and the
 * same contract as its `proc` sibling: the facts describe the WAIT, not the
 * transport. A wait's own facts are the clock and what it watched, and the
 * clock is load-bearing — omp reports no duration on the result at all, so the
 * value comes from the snapshot's job `durationMs` while the call blocks and
 * from the span the fold measured once it settles. Without it a call that
 * blocked for two minutes read exactly like one that returned instantly.
 */

import type { ToolCallData } from '@/shared/types/chat';
import { waitCounts, waitJobSpanMs, waitViewOf } from '@/shared/lib/omp/session/wait';
import { waitIdleLabel, waitIdleOf } from '@/shared/lib/omp/session/wait-idle';
import { countPhrase, formatToolMs } from '@/shared/lib/chat/tool/labels';
import type { ToolFact } from '@/shared/lib/chat/tool/summary';

/** Facts for a `wait` result (and a `send`, which shares `CoordinationDetails`). */
export function waitFacts(tool: ToolCallData): ToolFact[] {
  const view = waitViewOf(tool);
  if (!view) return [];
  const facts: ToolFact[] = [];
  const counts = waitCounts(view);
  // The CALL's span, never a watched job's: a job routinely starts before the
  // wait that watches it (measured: `bg_8` reported 126 s while the call that
  // waited on it took 20 s). The job span is only a fallback for a call whose
  // own clock is unknown.
  const elapsed = tool.durationMs
    ?? (tool.startedAt !== undefined ? Math.max(0, Date.now() - tool.startedAt) : waitJobSpanMs(view));
  if (elapsed !== undefined) facts.push({ kind: 'time', label: formatToolMs(elapsed) });
  // A wait whose result has not been reported yet (a reload mid-call, or omp's
  // own `details: {}`) has an UNKNOWN job list, not an empty one: claiming
  // "no jobs" would say the call looked and found none.
  if (!view.reported) return facts;
  // An idle window is the RESULT of this call, so it is read before the job
  // count: a wait whose window elapsed with jobs still running reports both.
  const idle = waitIdleOf(tool.output);
  if (counts.total > 0) {
    facts.push({ kind: 'count', label: countPhrase(counts.total, 'job') });
    if (counts.running > 0) facts.push({ kind: 'note', label: `${counts.running} running` });
    if (counts.failed > 0) facts.push({ kind: 'warn', label: `${counts.failed} failed`, tone: 'error' });
  }
  if (view.interrupted) facts.push({ kind: 'warn', label: 'interrupted', tone: 'warn' });
  // An idle return is an OUTCOME, not an absence: omp answers the same
  // `{op:'wait', jobs:[]}` for a service wake and for a reply that can no longer
  // arrive, and only the prose tells them apart. Without this chip an idle wait
  // read as `no jobs`, which says the call found nothing rather than that its
  // window elapsed (omp 18.17.0 removed the 30-minute cap that used to name it).
  else if (idle) facts.push({ kind: 'warn', label: waitIdleLabel(idle), tone: 'warn' });
  else if (view.waited.length > 0) {
    facts.push({ kind: 'note', label: countPhrase(view.waited.length, 'message') });
  } else if (counts.total === 0) facts.push({ kind: 'note', label: 'no jobs' });
  return facts;
}
