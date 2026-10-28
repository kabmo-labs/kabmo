/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Server-side pagination for the raw messages panel. Scans the session JSONL
 * like ./telemetry.ts but materializes at most one page of `RawMessageItem`s,
 * so the payload-heavy entries never leave the server in bulk.
 *
 * The sliding window keeps MATCHES, and only the page that is returned is
 * built — building every match to discard all but one page cost 48.9 ms on an
 * 11 MB session against 1.9 ms for the page itself.
 */

import type { RawMessageItem } from '@/shared/types/context';
import { buildInfo, formatTs, scanSessionEntries, textOf, tokensOf, type OmpMessage, type OmpMessageEntry } from '@/server/lib/omp/session/telemetry';
import { contentProfile } from '@/shared/lib/omp/session/telemetry-blocks';

export type RawMessageRole = 'all' | 'assistant' | 'user';

export interface RawMessagesPage {
  items: RawMessageItem[];
  total: number;
  filteredTotal: number;
}

/**
 * Read one page of raw messages, newest-first. The scan keeps a sliding
 * window of the last `page * pageSize` matches and slices its tail, so
 * server memory stays O(page) regardless of session length.
 */
export async function computeRawMessagesPage(
  filePath: string,
  page: number,
  pageSize: number,
  role: RawMessageRole = 'all',
): Promise<RawMessagesPage> {
  const windowSize = Math.max(1, page) * pageSize;
  // The window holds the last `windowSize` MATCHES, not built items. Building
  // every match and discarding all but one page was the whole cost of this
  // endpoint: on an 11 MB session, `buildRawItem` over all 1017 matches took
  // 48.9 ms while building only the 50 that are returned took 1.9 ms — the scan
  // that collects them is 0.2 ms.
  const window: { entry: OmpMessageEntry; msg: OmpMessage; index: number }[] = [];
  let head = 0;
  let total = 0;
  let filteredTotal = 0;
  let cwd = '';

  await scanSessionEntries(filePath, (entry, index) => {
    if (entry.type === 'session') {
      if (!cwd) cwd = entry.cwd ?? '';
      return;
    }
    if (entry.type !== 'message' || !entry.message) return;

    const msg = entry.message;
    // Match computeRealSessionTelemetry: only user/assistant messages are raw
    // panel items — toolResult entries are bookkeeping, not listed.
    if (msg.role !== 'assistant' && msg.role !== 'user') return;
    const msgRole: 'assistant' | 'user' = msg.role;
    total++;
    if (role !== 'all' && msgRole !== role) return;
    filteredTotal++;

    window.push({ entry, msg, index });
    if (window.length - head > windowSize) head++;
  });

  // `window` holds the last `windowSize` matches, oldest→newest, where
  // windowSize = page * pageSize. Page N is the Nth-newest chunk of pageSize
  // rows: skip the (page-1) newest chunks, take one, flip for display. Both
  // bounds clamp at 0 so out-of-range pages return an empty list.
  const skipNewest = (Math.max(1, page) - 1) * pageSize;
  const live = window.length - head;
  const end = Math.max(0, live - skipNewest);
  const start = Math.max(0, end - pageSize);
  const items: RawMessageItem[] = [];
  for (let i = head + start; i < head + end; i++) {
    const match = window[i];
    items.push(buildRawItem(match.entry, match.msg, cwd, match.index));
  }
  items.reverse();
  return { items, total, filteredTotal };
}

function buildRawItem(
  entry: OmpMessageEntry,
  msg: OmpMessage,
  cwd: string,
  index: number,
): RawMessageItem {
  const isAssistant = msg.role === 'assistant';
  const text = textOf(msg.content);
  const profile = contentProfile(msg.content);
  const snippet = text.slice(0, 70);
  const tokens = tokensOf(msg.usage);
  return {
    id: entry.id ?? `m${index}`,
    type: isAssistant ? (profile.parts.length ? profile.parts.join('_') : 'text') : 'user',
    badgeLabel: isAssistant
      ? (profile.parts.length ? profile.parts.join(' + ') : 'text')
      : `user: ${snippet}${text.length > 70 ? '...' : ''}`,
    tokenSummary: isAssistant
      ? `${tokens.input.toLocaleString()} / ${tokens.output.toLocaleString()}`
      : '',
    timestamp: formatTs(entry.timestamp),
    info: buildInfo(entry, msg, cwd, index),
    rawPayload: entry as unknown as Record<string, any>,
  };
}
