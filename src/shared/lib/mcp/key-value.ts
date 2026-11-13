/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The key/value rows the MCP form edits (env vars, HTTP headers) and the
 * `Record<string, string>` omp's `mcp.json` stores. One conversion pair, so the
 * form, the writer and the session registry cannot disagree about which rows
 * are real: a blank key is a half-typed row, and the redaction sentinel is a
 * display placeholder that must never be written or injected.
 */

import type { McpKeyValue } from '@/shared/types';

/** The value the server sends instead of a credential it will not disclose. */
export const REDACTED_SENTINEL = '••••••••';

/** Rows → a record, dropping blank keys and the redaction sentinel. */
export function rowsToRecord(rows: readonly McpKeyValue[] | undefined): Record<string, string> | undefined {
  const record: Record<string, string> = {};
  for (const row of rows ?? []) {
    const key = row?.key?.trim();
    if (!key || !row.value || row.value === REDACTED_SENTINEL) continue;
    record[key] = row.value;
  }
  return Object.keys(record).length > 0 ? record : undefined;
}

/** A native record → rows, stringifying non-string values the way omp does. */
export function recordToRows(record: Record<string, unknown>, prefix: string): McpKeyValue[] {
  return Object.entries(record).map(([key, value], index) => ({
    id: `${prefix}-${index}`,
    key,
    value: typeof value === 'string' ? value : String(value),
  }));
}
