/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The TAIL of a session JSONL, for readers whose answer is "the last record of
 * this type".
 *
 * `model_change` and `thinking_level_change` are append-only state: omp writes a
 * new entry each time the user changes either, and the loader's rule is "the last
 * one wins". That answer is always near the END of the file, so reading the whole
 * file to find it is pure waste — and it was not cheap waste. Measured on this
 * machine (an 11 MB session, 1,024 messages), one `GET /api/chat/:id` read the
 * file FOUR times: the transcript, the model, the thinking level and a 32 KiB
 * title window. Removing two of those full reads is the difference between
 * 1.69 GB and a much smaller peak under 20 concurrent requests, because each
 * concurrent read holds its own copy of the string and of the parsed records.
 *
 * A tail read is only valid while the answer is in the tail, so this reports
 * whether it covered the whole file: a caller that finds nothing must fall back
 * to the full read rather than answer "undefined", which is what a session whose
 * last change predates the window would otherwise report.
 */

/** Records plus whether the read covered the entire file. */
export interface JsonlTail {
  records: Record<string, unknown>[];
  /** True when the window started at byte 0, so a miss is a real miss. */
  complete: boolean;
}

/**
 * Parse the last `maxBytes` of a JSONL file.
 *
 * The window usually starts mid-line, so everything before the first newline is
 * discarded — a truncated JSON object would otherwise be handed to the lenient
 * parser as a record that never existed. UTF-8 safety follows from that same
 * rule: a multibyte character split by the byte offset can only corrupt the
 * fragment that is dropped.
 *
 * Never throws: an unreadable file answers `{ records: [], complete: false }`, so
 * the caller falls back to the full read and reports the failure the way it
 * already did.
 */
export async function readJsonlTail(
  filePath: string,
  maxBytes: number,
  parse: (body: string) => Record<string, unknown>[],
): Promise<JsonlTail> {
  try {
    const file = Bun.file(filePath);
    const size = (await file.stat()).size;
    if (size <= maxBytes) {
      return { records: parse(await file.text()), complete: true };
    }
    const start = size - maxBytes;
    const window = await file.slice(start, size).text();
    const newline = window.indexOf('\n');
    // A window with no newline at all holds one partial record; there is nothing
    // to read and the caller must go back for the whole file.
    if (newline === -1) return { records: [], complete: false };
    return { records: parse(window.slice(newline + 1)), complete: false };
  } catch {
    return { records: [], complete: false };
  }
}
