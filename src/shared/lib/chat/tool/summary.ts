/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The one line a collapsed tool card says about what the call DID.
 *
 * A closed card used to carry only its title and a status badge, so a `bash`
 * that finished in 28ms with exit 0 read exactly like one that failed, and a
 * `grep` never named the pattern it searched for. The data was always there —
 * omp puts it in `toolResult.details`, which every panel already reads — but
 * nothing read it until the card was opened.
 *
 * This module is pure and DOM-free so both halves of the card can use it: the
 * header renders `facts` as chips while collapsed, and a panel may render the
 * same facts above its body. One derivation, so the two can never disagree.
 *
 * Coverage measured over 5,441 real tool results (6 largest sessions):
 *   bash  wallTimeMs 97% · edit diff+firstChangedLine 99% · grep matchCount 100%
 *   read  fileSize 95%, totalLines 76% · eval cells 100% · glob fileCount 100%
 *   write resolvedPath 94% · todo phases 100%
 * `exitCode` is present on only 2% of bash results (omp reports wall time, not
 * the code), so a missing code degrades to no chip rather than a fabricated 0.
 */

import type { ToolCallData } from '@/shared/types/chat';
import { procPathOf } from '@/shared/lib/omp/session/proc';
import { isExcerptFurniture } from '@/shared/lib/chat/excerpt';
import { bashServiceFacts, procFacts } from '@/shared/lib/chat/tool/proc-facts';
import {
  countPhrase,
  diffLabel,
  excerptDiffCounts,
  formatToolBytes,
  formatToolMs,
} from '@/shared/lib/chat/tool/labels';

// `formatToolMs`/`formatToolBytes` are public helpers other surfaces import
// from here; they live in `labels.ts` now, re-exported so no call site moved.
export { formatToolBytes, formatToolMs };

/** One colored segment inside a fact — a `+4` that must be green and a `−1`
 *  that must be red, in a chip that is otherwise plain ink. */
export interface ToolFactPart {
  label: string;
  tone: 'ok' | 'error';
}

/** One fact rendered as a chip. `kind` lets a caller pick an icon or reorder. */
export interface ToolFact {
  kind: 'exit' | 'time' | 'size' | 'range' | 'count' | 'diff' | 'progress' | 'subject' | 'warn' | 'note';
  label: string;
  /** Chip tone; `muted` is the default for informational facts. */
  tone?: 'ok' | 'warn' | 'error' | 'muted';
  /**
   * Colored segments that replace `label` in the chip. A diff is the case this
   * exists for: `+4` and `−1` are two different claims and must not share one
   * colour, while staying ONE chip so they cannot be separated by the chip
   * overflow rule. `label` is still the plain-text form for the tooltip, the
   * joined `line`, and anything that reads the fact as a string.
   */
  parts?: ToolFactPart[];
  /** Full text for the chip's tooltip when `label` is elided. */
  title?: string;
}

export interface ToolSummary {
  /** Facts in render order. */
  facts: ToolFact[];
  /** The facts joined into one line — for a `title` attribute or a plain row. */
  line: string;
}

/** A tool result's `details` bag, narrowed to what a reader may index into. */
type Details = Record<string, unknown>;

function asRecord(value: unknown): Details | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Details) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const found = asString(value);
    if (found) return found;
  }
  return undefined;
}

/** Elide a subject to a chip's width, keeping the full text for its tooltip. */
function subjectFact(label: string): ToolFact {
  return label.length > 60
    ? { kind: 'subject', label: `${label.slice(0, 59)}…`, title: label }
    : { kind: 'subject', label, title: label };
}

/** Search subject for `grep`/`glob`: the PATTERN the reader wants, never the
 *  path. The path is the card's subtitle, so a subject that fell back to it
 *  printed the same string twice on one row (`public/**; *.json` as both the
 *  subtitle and the first chip). A glob with no pattern therefore has no
 *  subject chip — its path IS the subject, and the subtitle shows it. */
function searchSubject(input: Details | undefined): string | undefined {
  return firstString(input?.pattern, input?.query, input?.regex, input?.search, input?.text);
}

/**
 * Facts for one tool call, in the order a reader wants them: outcome first,
 * then cost, then subject.
 */
export function toolSummary(tool: ToolCallData): ToolSummary | null {
  const details = asRecord(tool.details) ?? {};
  const input = asRecord(tool.input);
  const facts: ToolFact[] = [];
  const key = (tool.name || tool.type || '').toLowerCase();
  const isError = tool.status === 'error' || tool.isError === true;
  // A `proc://` call rides the `read`/`write` transport, and neither panel's
  // facts describe it: a `write` would report the stdin payload as a file's
  // line count, a `read` the service log as a file size.
  const isProc = key === 'hub' || key === 'proc' || procPathOf(tool) !== undefined;

  // ── bash / terminal ───────────────────────────────────────────────────────
  if (key === 'bash' || key === 'terminal' || key === 'run_command') {
    // A `bash` that launches a named service answers with `details.service` —
    // the same snapshot `proc://<id>` reports — and its identity leads the row:
    // an exit code is not the story for a process that is meant to keep running.
    facts.push(...bashServiceFacts(tool));
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
  }

  // ── edit / write ──────────────────────────────────────────────────────────
  if (!isProc && (key === 'edit' || key === 'write' || key === 'edit_file' || key === 'create_file')) {
    const diff = firstString(details.diff, details.patch);
    if (diff) {
      const counts = excerptDiffCounts(diff);
      if (counts) {
        // Additions green, deletions red, in ONE chip: two chips would let the
        // overflow rule show `+43` and hide `−16`, which is worse than showing
        // neither. No tone on the chip itself — the colour lives in the parts.
        const parts: ToolFactPart[] = [];
        if (counts.added > 0) parts.push({ label: `+${counts.added}`, tone: 'ok' });
        if (counts.removed > 0) parts.push({ label: `\u2212${counts.removed}`, tone: 'error' });
        facts.push({ kind: 'diff', label: diffLabel(counts.added, counts.removed), parts });
      }
    } else if (key === 'write') {
      // A write carries the whole file as its input, so its size IS the change.
      const content = firstString(input?.content);
      if (content) facts.push({ kind: 'size', label: `${content.split('\n').length} lines` });
    }
    const firstChanged = asNumber(details.firstChangedLine);
    if (firstChanged !== undefined && firstChanged > 0) {
      facts.push({ kind: 'range', label: `line ${firstChanged}` });
    }
    const diagnostics = asRecord(details.diagnostics);
    const diagnosticSummary = diagnostics ? asString(diagnostics.summary) : undefined;
    if (diagnosticSummary) {
      facts.push({
        kind: 'note',
        label: diagnosticSummary,
        tone: diagnostics?.errored === true ? 'error' : diagnosticSummary === 'no issues' ? 'ok' : 'warn',
      });
    }
    if (details.madeExecutable === true) facts.push({ kind: 'note', label: '+x', tone: 'ok' });
  }

  // ── read ──────────────────────────────────────────────────────────────────
  if (!isProc && (key === 'read' || key === 'read_file' || key === 'view_file' || key === 'read_file_content')) {
    if (details.isDirectory === true) {
      const entryCount = asNumber(details.fileCount);
      facts.push({
        kind: 'count',
        label: entryCount !== undefined ? `${entryCount} ${entryCount === 1 ? 'entry' : 'entries'}` : 'directory',
      });
    } else {
      const fileSize = asNumber(details.fileSize);
      if (fileSize !== undefined) facts.push({ kind: 'size', label: formatToolBytes(fileSize) });
      const totalLines = asNumber(details.totalLines);
      if (totalLines !== undefined) facts.push({ kind: 'count', label: `${totalLines} lines` });
      const truncation = asRecord(details.truncation);
      const shown = asRecord(truncation?.shownRange);
      const shownStart = asNumber(shown?.start);
      const shownEnd = asNumber(shown?.end);
      if (shownStart !== undefined && shownEnd !== undefined) {
        facts.push({ kind: 'range', label: `shown ${shownStart}\u2013${shownEnd}`, tone: 'warn' });
      } else if (truncation?.truncated === true) {
        facts.push({ kind: 'warn', label: 'truncated', tone: 'warn' });
      }
    }
  }

  // ── grep / glob / ast_grep ────────────────────────────────────────────────
  // The scope (`src`, `public/**`) is the card's SUBTITLE, so it is not
  // repeated as a chip: `searchScope` used to add it here, which printed the
  // same string on both halves of one row for a `glob`.
  if (key === 'grep' || key === 'glob' || key === 'ast_grep' || key === 'search_fs') {
    const subject = searchSubject(input);
    if (subject) facts.push(subjectFact(subject));
    const matchCount = asNumber(details.matchCount);
    const fileCount = asNumber(details.fileCount);
    if (matchCount !== undefined) {
      const files = fileCount !== undefined ? ` in ${countPhrase(fileCount, 'file')}` : '';
      facts.push({ kind: 'count', label: `${countPhrase(matchCount, 'match', 'matches')}${files}` });
    } else if (fileCount !== undefined) {
      facts.push({ kind: 'count', label: countPhrase(fileCount, 'file') });
    }
    if (details.truncated === true || details.resultLimitReached !== undefined) {
      facts.push({ kind: 'warn', label: 'truncated', tone: 'warn' });
    }
  }

  // ── eval ──────────────────────────────────────────────────────────────────
  if (key === 'eval') {
    const language = firstString(details.language, input?.language);
    if (language) facts.push({ kind: 'note', label: language.toLowerCase() });
    const cells = asArray(details.cells);
    if (cells.length > 0) facts.push({ kind: 'count', label: countPhrase(cells.length, 'cell') });
    const ops = Array.from(
      new Set(
        asArray(details.statusEvents)
          .map((event) => firstString(asRecord(event)?.detail, asRecord(event)?.op))
          .filter((op): op is string => op !== undefined),
      ),
    ).slice(0, 3);
    if (ops.length > 0) facts.push(subjectFact(ops.join(' · ')));
  }

  // ── todo ──────────────────────────────────────────────────────────────────
  if (key === 'todo') {
    const tasks = asArray(details.phases).flatMap((phase) => asArray(asRecord(phase)?.tasks));
    if (tasks.length > 0) {
      const closed = tasks.filter((task) => {
        const status = asString(asRecord(task)?.status);
        return status === 'completed' || status === 'abandoned';
      }).length;
      facts.push({ kind: 'progress', label: `${closed}/${tasks.length} done` });
      const blocked = tasks.filter((task) => asString(asRecord(task)?.status) === 'blocked').length;
      if (blocked > 0) facts.push({ kind: 'warn', label: `${blocked} blocked`, tone: 'warn' });
    }
    const op = firstString(details.op);
    if (op) facts.push({ kind: 'note', label: op });
  }

  // ── proc:// (and the legacy `hub` tool) ───────────────────────────────────
  // The outcome a reader wants first is the PROCESS's, not the transport's:
  // `stop · exited · ran 16m`, `stdin · ready · pid 22985`, `3 jobs · 1 running`.
  if (isProc) facts.push(...procFacts(tool));

  // ── web_search ────────────────────────────────────────────────────────────
  if (key === 'web_search') {
    const results = asArray(asRecord(details.response)?.results);
    if (results.length > 0) {
      facts.push({ kind: 'count', label: countPhrase(results.length, 'result') });
      const url = firstString(asRecord(results[0])?.url);
      if (url) {
        try {
          facts.push({ kind: 'note', label: new URL(url).hostname });
        } catch {
          // A malformed url is not worth a chip.
        }
      }
    }
    const query = firstString(input?.query);
    if (query) facts.push(subjectFact(query));
  }

  // ── task (subagents) ──────────────────────────────────────────────────────
  if (key === 'task') {
    const results = asArray(details.results);
    if (results.length > 0) {
      facts.push({ kind: 'count', label: countPhrase(results.length, 'subagent') });
      const running = results.filter((row) => asString(asRecord(row)?.status) === 'running').length;
      if (running > 0) facts.push({ kind: 'note', label: `${running} running` });
      const failed = results.filter((row) => {
        const status = asString(asRecord(row)?.status);
        return status === 'failed' || status === 'aborted';
      }).length;
      if (failed > 0) facts.push({ kind: 'warn', label: `${failed} failed`, tone: 'error' });
    }
  }

  // ── fallback: any tool whose output is the only thing worth naming ────────
  if (facts.length === 0) {
    const lines = (tool.output ?? '').split(/\r?\n/);
    // The subject is the first meaningful line that is not excerpt furniture —
    // an `edit`/`write` result leads with the `[path]` header of the excerpt it
    // touched, which is the card's own SUBTITLE, and naming it here printed the
    // path twice on one row.
    //
    // A file-content tool's output IS the file body, and the card's SUBTITLE
    // already names the path — so its first line is never the subject, whether
    // or not the furniture rule recognised it. That covers a gutter-less read
    // (measured on 13 of 994 read results), a legacy `read_file` returning raw
    // JSON, and any excerpt whose rows the rule misses. A FAILED one carries a
    // prose reason ("Path 'src/gone.ts' not found") that IS worth naming, so the
    // gate opens for an error result.
    const isFileBody = key === 'read' || key === 'read_file' || key === 'view_file'
      || key === 'read_file_content' || key === 'edit' || key === 'edit_file'
      || key === 'write' || key === 'create_file';
    if (!isFileBody || isError) {
      const first = lines.find((line) => line.trim() && !isExcerptFurniture(line));
      if (first) facts.push(subjectFact(first.trim()));
    }
    if (lines.length > 1) facts.push({ kind: 'count', label: `${lines.length} lines` });
  }

  if (facts.length === 0) return null;
  return { facts, line: facts.map((fact) => fact.label).join(' · ') };
}
