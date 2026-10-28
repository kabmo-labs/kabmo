/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The fact chips for a `proc://` call and for a `bash` service launch.
 *
 * Split out of `summary.ts` because both read the same snapshot through
 * `@/shared/lib/omp/session/proc` and the parent file is at its size ceiling.
 * The facts are the PROCESS's, never the transport's: the call rides `read`/
 * `write`, so a `write`'s own chip would report the stdin payload as a file's
 * line count and a `read`'s the service log as a file size.
 */

import { bashServiceOf, daemonTone, formatProcDuration, jobTone, procOpLabel, procUptime, procViewOf } from '@/shared/lib/omp/session/proc';
import { countPhrase } from '@/shared/lib/chat/tool/labels';
import type { ToolCallData } from '@/shared/types/chat';
import type { ToolFact } from '@/shared/lib/chat/tool/summary';

/** Facts for a `proc://` call (or the legacy `hub` tool, same `details`). */
export function procFacts(tool: ToolCallData): ToolFact[] {
  const view = procViewOf(tool);
  if (!view) return [];
  const facts: ToolFact[] = [];
  const op = procOpLabel(view.op);

  if (view.daemon) {
    const daemon = view.daemon;
    const tone = daemonTone(daemon.state);
    facts.push({
      kind: 'note',
      label: [op, daemon.state].filter(Boolean).join(' · '),
      tone: tone === 'muted' ? undefined : tone,
    });
    if (daemon.pid !== undefined) facts.push({ kind: 'count', label: `pid ${daemon.pid}` });
    const uptime = procUptime(daemon);
    if (uptime) {
      facts.push({ kind: 'time', label: `${typeof daemon.exitedAt === 'number' ? 'ran' : 'up'} ${uptime.label}` });
    }
    if (daemon.exitCode !== undefined) {
      facts.push({ kind: 'exit', label: `exit ${daemon.exitCode}`, tone: daemon.exitCode === 0 ? 'ok' : 'error' });
    }
    return facts;
  }

  if (view.job) {
    const job = view.job;
    const tone = jobTone(job.status);
    facts.push({
      kind: 'note',
      label: [op, job.status].filter(Boolean).join(' · '),
      tone: tone === 'muted' ? undefined : tone,
    });
    if (job.id) facts.push({ kind: 'count', label: job.id });
    if (typeof job.durationMs === 'number') {
      facts.push({ kind: 'time', label: formatProcDuration(job.durationMs) });
    }
    return facts;
  }

  // The listing, and a `/kill` that found background jobs: a cancelled row is
  // the call's OUTCOME, not part of the inventory it found — counting it as a
  // live process said "1 process · 1 job cancelled" for a kill of one job.
  const cancelledIds = new Set(view.cancelled.map((row) => row.id));
  const liveJobs = view.jobs.filter((job) => !cancelledIds.has(job.id));
  const total = liveJobs.length + view.daemons.length + view.agents.length;
  if (total > 0) {
    facts.push({ kind: 'count', label: countPhrase(total, 'process', 'processes') });
    const running = liveJobs.filter((job) => job.status === 'running').length;
    if (running > 0) facts.push({ kind: 'note', label: `${running} running` });
  }
  if (view.cancelled.length > 0) {
    facts.push({ kind: 'count', label: `${countPhrase(view.cancelled.length, 'job')} cancelled` });
  }
  return facts;
}

/** Facts for a `bash` that launched a named service, from `details.service`. */
export function bashServiceFacts(tool: ToolCallData): ToolFact[] {
  const service = bashServiceOf(tool);
  if (!service) return [];
  const tone = daemonTone(service.state);
  const facts: ToolFact[] = [
    {
      kind: 'note',
      label: [service.name, service.state].filter(Boolean).join(' · '),
      tone: tone === 'muted' ? undefined : tone,
    },
  ];
  if (service.pid !== undefined) facts.push({ kind: 'count', label: `pid ${service.pid}` });
  return facts;
}
