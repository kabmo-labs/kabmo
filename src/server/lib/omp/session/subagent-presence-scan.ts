/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Does a session file hold any subagent, decided WITHOUT materializing it.
 *
 * `extractSubagentHistory` answers the same question and is the roster source,
 * but it reads the whole transcript and lenient-parses every entry — for the
 * sidebar's presence badge that was measured at 1.38 GB of reads and a 900 MB
 * resident-set jump on a 1349-file / 2.0 GB agent directory, because Bun keeps
 * the freed arena. The badge needs one bit, so this walks the file as a stream
 * and stops at the first entry that would put something in the roster.
 *
 * The predicate is deliberately the SAME one the roster fold applies
 * (`createFolder` in `subagent/history/fold.ts`), or the badge would disagree
 * with the panel it opens:
 *
 * - a `task` toolResult entry whose `details.progress` names a subagent id
 *   (`parseSubagentProgress` → `id`), or
 * - a `task` toolResult entry whose `details.results` carries an id.
 *
 * Both are then filtered by `SUBAGENT_ID_RE` on upsert, so an id the fold would
 * reject is rejected here too.
 *
 * Memory stays bounded: one chunk plus the line being assembled, and an
 * oversized line (a tool result carrying a file read) is dropped rather than
 * held. A `task` result is small — its details are telemetry, outputs are
 * deliberately not copied — so the only lines this rule can lose are ones that
 * could not have matched.
 */

import { isRecord } from '@/shared/lib/util/guards';
import { parseSubagentProgress } from '@/shared/lib/omp/subagent/parse';
import { SUBAGENT_ID_RE } from '@/server/lib/omp/subagent/history/paths';

/** A line longer than this is not a `task` result; it is dropped unparsed. */
export const SESSION_PRESENCE_MAX_LINE_BYTES = 8 * 1024 * 1024;

/**
 * A cheap reject before the parse: every entry that could match contains both
 * a `task` tool name and a `toolResult` role. Skipping the other ~99% of lines
 * with two `includes` calls is what keeps a 2 GB cold scan in seconds.
 */
function couldBeTaskResult(line: string): boolean {
  return line.includes('"task"') && line.includes('toolResult');
}

/** The roster fold's own admission test, applied to one parsed entry. */
function admitsSubagent(entry: unknown): boolean {
  if (!isRecord(entry) || entry.type !== 'message') return false;
  const message = entry.message;
  if (!isRecord(message) || message.role !== 'toolResult' || message.toolName !== 'task') return false;
  const details = isRecord(message.details) ? message.details : {};
  const progress = Array.isArray(details.progress) ? details.progress : [];
  for (const raw of progress) {
    const id = parseSubagentProgress(raw)?.id;
    if (id !== undefined && SUBAGENT_ID_RE.test(id)) return true;
  }
  const results = Array.isArray(details.results) ? details.results : [];
  for (const raw of results) {
    if (!isRecord(raw)) continue;
    const id = raw.id;
    if (typeof id === 'string' && SUBAGENT_ID_RE.test(id)) return true;
  }
  return false;
}

/** One line of the file, parsed and admitted, with a torn line answering `false`. */
function lineAdmitsSubagent(line: string): boolean {
  if (!couldBeTaskResult(line)) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    // A torn line is not a roster entry; the fold would skip it too.
    return false;
  }
  return admitsSubagent(parsed);
}

/**
 * True when the session file holds at least one subagent entry.
 *
 * A read failure THROWS rather than answering `false`: presence is a badge,
 * and the caller decides whether an unreadable transcript should be reported
 * as absent (it is, for this call) or remembered (it must not be).
 */
export async function sessionFileHasSubagents(filePath: string): Promise<boolean> {
  const decoder = new TextDecoder();
  // A reader rather than `for await`: Bun's stream is async-iterable at
  // runtime, but the TypeScript DOM definition of `ReadableStream` is not.
  const reader = Bun.file(filePath).stream().getReader();
  let pending = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let newline = pending.indexOf('\n');
      while (newline !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (line.length <= SESSION_PRESENCE_MAX_LINE_BYTES && lineAdmitsSubagent(line)) return true;
        newline = pending.indexOf('\n');
      }
      if (pending.length > SESSION_PRESENCE_MAX_LINE_BYTES) {
        // An oversized line: drop what we hold and let the rest of it arrive as
        // a fragment the next newline discards. See the module note.
        pending = '';
      }
    }
  } finally {
    // A hit returns early; the rest of the transcript is not needed.
    reader.cancel().catch(() => {});
  }
  pending += decoder.decode();
  return lineAdmitsSubagent(pending.trim());
}