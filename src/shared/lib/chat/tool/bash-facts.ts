/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The fact chips for a `bash` call: outcome, cost, and what omp did to the
 * output.
 *
 * Split out of `summary.ts`, which is at the repo's per-file ceiling, with the
 * same contract as its `proc`/`wait` siblings — the facts describe the CALL,
 * never the transport.
 *
 * Order is load-bearing: a service launch's identity leads (an exit code is not
 * the story for a process meant to keep running), then the exit code, the
 * clock, the output's size, and finally the two things that qualify the body on
 * screen — the shell minimizer's rewrite (omp 18.16.0) and a background job.
 */

import type { ToolCallData } from '@/shared/types/chat';
import type { ToolFact } from '@/shared/lib/chat/tool/summary';
import { bashServiceFacts } from '@/shared/lib/chat/tool/proc-facts';
import { formatToolMs } from '@/shared/lib/chat/tool/labels';
import { minimizedLabel, minimizedOutputOf } from '@/shared/lib/chat/tool/minimized';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** Every fact a collapsed `bash` card states about the call. */
export function bashFacts(tool: ToolCallData, isError: boolean): ToolFact[] {
  const details = asRecord(tool.details) ?? {};
  const facts: ToolFact[] = [
    // A `bash` that launches a named service answers with `details.service` —
    // the same snapshot `proc://<id>` reports.
    ...bashServiceFacts(tool),
  ];

  const exitCode = asNumber(details.exitCode);
  if (exitCode !== undefined) {
    facts.push({ kind: 'exit', label: `exit ${exitCode}`, tone: exitCode === 0 ? 'ok' : 'error' });
  } else if (isError) {
    facts.push({ kind: 'exit', label: 'failed', tone: 'error' });
  }

  const wallMs = asNumber(details.wallTimeMs);
  if (wallMs !== undefined) {
    facts.push({ kind: 'time', label: formatToolMs(wallMs) });
  } else if (tool.duration || tool.time) {
    // The MOCK/legacy path carries a preformatted duration instead of
    // `wallTimeMs`; it is the same fact in the same slot.
    facts.push({ kind: 'time', label: tool.duration || tool.time || '' });
  }

  // omp 18.16.0 rewrote the output through its shell minimizer and says so in
  // `details.meta.minimized`. Without this chip the card showed the compressed
  // body as if the command had produced it — a reader comparing the log they
  // expected with the one on screen had no way to know 7 KB were dropped.
  //
  // It ranks BEFORE the line count on purpose: the count describes the text
  // below, which is the rewrite. A collapsed row shows two facts beside its
  // subtitle, so a rewrite named last would be the one folded into `+1` — the
  // qualifier hidden behind the number it qualifies.
  const minimized = minimizedOutputOf(tool);
  if (minimized) {
    facts.push({ kind: 'note', label: minimizedLabel(minimized), tone: 'warn' });
  }

  const output = (tool.output ?? '').trimEnd();
  if (output) {
    const lines = output.split(/\r?\n/).length;
    if (lines > 1) facts.push({ kind: 'count', label: `${lines} lines` });
  }

  const async = asRecord(details.async);
  if (async?.state === 'running') {
    facts.push({ kind: 'warn', label: `background ${asString(async.jobId) ?? ''}`.trim(), tone: 'warn' });
  }

  const timeoutSeconds = asNumber(details.timeoutSeconds);
  if (exitCode === undefined && isError && timeoutSeconds !== undefined) {
    facts.push({ kind: 'note', label: `timeout ${timeoutSeconds}s`, tone: 'warn' });
  }

  return facts;
}
