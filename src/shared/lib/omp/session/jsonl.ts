/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Low-level JSONL + header parsing for oh-my-pi session files.
 *
 * Trimmed from omp-web/lib/omp/session-files.ts (itself a port of oh-my-pi
 * session-listing.ts). These helpers derive a session header from a small
 * prefix window of a `.jsonl` file, tolerating truncated lines via lenient
 * parsing and raw-text string scans. Nothing here touches the filesystem.
 */

import { isRecord } from '@/shared/lib/util/guards';

/** JSON.stringify never emits raw newlines, so line splitting is a faithful
 *  lenient JSONL parse: malformed/truncated lines are skipped, not fatal. */
export function parseJsonlLenient<T>(body: string): T[] {
  const out: T[] = [];
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // Skip malformed line (torn write, prefix-window truncation).
    }
  }
  return out;
}

export function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const text: string[] = [];
  for (const block of content) {
    if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') text.push(block.text);
  }
  return text.join(' ');
}

// ============================================================================
// Raw-text string scans (tolerate a header line straddling the prefix window)
// ============================================================================

function decodeJsonStringFragment(value: string): string {
  const safeValue = value.endsWith('\\') ? value.slice(0, -1) : value;
  try {
    return JSON.parse(`"${safeValue}"`) as string;
  } catch {
    return safeValue
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
}

/** Raw-text string-property scan used on the possibly-truncated prefix window. */
export function extractStringProperty(source: string, name: string, startIndex = 0): string | undefined {
  const propertyIndex = source.indexOf(`"${name}"`, startIndex);
  if (propertyIndex === -1) return undefined;
  const colonIndex = source.indexOf(':', propertyIndex + name.length + 2);
  if (colonIndex === -1) return undefined;

  let valueIndex = colonIndex + 1;
  while (valueIndex < source.length) {
    const char = source.charCodeAt(valueIndex);
    if (char !== 32 && char !== 9 && char !== 10 && char !== 13) break;
    valueIndex++;
  }
  if (source.charCodeAt(valueIndex) !== 34) return undefined;

  const valueStart = valueIndex + 1;
  let escaped = false;
  for (let i = valueStart; i < source.length; i++) {
    const char = source.charCodeAt(i);
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === 92) {
      escaped = true;
      continue;
    }
    if (char === 34) {
      return decodeJsonStringFragment(source.slice(valueStart, i));
    }
  }
  return decodeJsonStringFragment(source.slice(valueStart));
}

export function countMessageMarkers(content: string): number {
  let count = 0;
  let index = 0;
  while (index < content.length) {
    const typeIndex = content.indexOf('"type"', index);
    if (typeIndex === -1) break;
    const colonIndex = content.indexOf(':', typeIndex + 6);
    if (colonIndex === -1) break;
    if (extractStringProperty(content, 'type', typeIndex) === 'message') count++;
    index = colonIndex + 1;
  }
  return count;
}

// ============================================================================
// Header parsing
// ============================================================================

export interface SessionListHeader {
  id: string;
  cwd?: string;
  title?: string;
  parentSession?: string;
  timestamp?: string;
}

function normalizeTitleOverride(title: string | undefined): string | null | undefined {
  if (title === undefined) return undefined;
  return title.trim() ? title : null;
}

function sessionListHeaderFromRecord(
  record: Record<string, unknown> | undefined,
  titleOverride?: string | null,
): SessionListHeader | undefined {
  if (record?.type !== 'session' || typeof record.id !== 'string') return undefined;
  return {
    id: record.id,
    cwd: typeof record.cwd === 'string' ? record.cwd : undefined,
    title:
      titleOverride === null
        ? undefined
        : (titleOverride ?? (typeof record.title === 'string' ? record.title : undefined)),
    parentSession: typeof record.parentSession === 'string' ? record.parentSession : undefined,
    timestamp: typeof record.timestamp === 'string' ? record.timestamp : undefined,
  };
}

function parseSessionListHeaderLine(line: string, titleOverride?: string | null): SessionListHeader | undefined {
  if (extractStringProperty(line, 'type') !== 'session') return undefined;
  const id = extractStringProperty(line, 'id');
  if (!id) return undefined;
  return {
    id,
    cwd: extractStringProperty(line, 'cwd'),
    title: titleOverride === null ? undefined : (titleOverride ?? extractStringProperty(line, 'title')),
    parentSession: extractStringProperty(line, 'parentSession'),
    timestamp: extractStringProperty(line, 'timestamp'),
  };
}

/** Parse the header from the prefix window; slot titles override header titles.
 *  Falls back to a raw-text scan when the header line straddles the window. */
export function parseSessionListHeader(
  content: string,
  entries: Array<Record<string, unknown>>,
): SessionListHeader | undefined {
  const firstEntry = entries[0];
  const parsedSlotTitle = normalizeTitleOverride(
    firstEntry?.type === 'title' && typeof firstEntry.title === 'string' ? firstEntry.title : undefined,
  );
  const parsedHeader = sessionListHeaderFromRecord(entries[firstEntry?.type === 'title' ? 1 : 0], parsedSlotTitle);
  if (parsedHeader) return parsedHeader;

  let slotTitle: string | null | undefined;
  let firstNonEmpty = true;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (firstNonEmpty && extractStringProperty(line, 'type') === 'title') {
      slotTitle = normalizeTitleOverride(extractStringProperty(line, 'title'));
      firstNonEmpty = false;
      continue;
    }
    return parseSessionListHeaderLine(line, slotTitle);
  }
  return undefined;
}
