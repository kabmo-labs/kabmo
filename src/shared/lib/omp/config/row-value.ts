/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Text ↔ value conversion for one omp config row.
 *
 * `omp config set` accepts a string, number, boolean, array or record, and the
 * schema decides which one a row holds. The panel edits everything as text, so
 * this module is where a keystroke becomes a typed value — and where invalid
 * text is REJECTED instead of being silently dropped. The old editor reverted
 * on a parse failure with no message, so a trailing comma in a JSON array
 * looked like the field had simply refused to save.
 */

import type { SchemaEntry } from '@/shared/lib/omp/config/schema-types';

/** A row's draft parsed back into the value to write, or a reason it cannot be. */
export type ParsedValue =
  | { ok: true; value: string | number | boolean | unknown[] | Record<string, unknown> }
  | { ok: false; error: string };

/** Deep equality for JSON-safe values (arrays, records, scalars). */
export function valuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Render a stored value as the text its editor shows. */
export function valueToText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value) || typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Number-editor conversion: an incomplete or non-finite entry is not a value. */
export function parseFiniteNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '-' || trimmed === '+' || trimmed === '.') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Parse a JSON array; `null` when the text is not one. */
export function parseJsonArray(raw: string): unknown[] | null {
  const trimmed = raw.trim();
  if (trimmed === '') return [];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Parse a JSON record; `null` when the text is not one. */
export function parseJsonRecord(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (trimmed === '') return {};
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Interpret a draft for a text-editable row type.
 *
 * An empty number is "no value" rather than `NaN`; an empty string is a value
 * (clearing a credential field is a real write); JSON text must parse to the
 * shape the schema names.
 */
export function parseDraft(type: SchemaEntry['type'], raw: string): ParsedValue {
  if (type === 'number') {
    const parsed = parseFiniteNumber(raw);
    return parsed === null
      ? { ok: false, error: 'A number is required, e.g. 1200.' }
      : { ok: true, value: parsed };
  }
  if (type === 'array') {
    const parsed = parseJsonArray(raw);
    return parsed === null
      ? { ok: false, error: 'This key is a JSON array, e.g. ["anthropic","openai"].' }
      : { ok: true, value: parsed };
  }
  if (type === 'record') {
    const parsed = parseJsonRecord(raw);
    return parsed === null
      ? { ok: false, error: 'This key is a JSON object, e.g. {"bash":"prompt"}.' }
      : { ok: true, value: parsed };
  }
  return { ok: true, value: raw.trim() };
}
