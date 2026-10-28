/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reading a JSON body nobody typed.
 *
 * Both adapters parse responses from a host this plugin does not control, so
 * every field is `unknown` until a guard has said otherwise. The helpers here are
 * the whole vocabulary of that: an object check, a string, a number, a boolean
 * and a list — each answering a DEFAULT rather than throwing, because one
 * missing field on one row must not lose the other twenty-nine.
 *
 * The functions are deliberately named for the shape they return (`asRecord`,
 * `text`) rather than for the API they read, so the adapters read as a
 * transcription of the response instead of a pile of casts.
 */

export type Json = unknown;

/** A JSON object, or null. */
export function asRecord(value: Json): Record<string, Json> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, Json>)
    : null;
}

/** The array at `key`, or an empty list. */
export function listAt(value: Json): Json[] {
  return Array.isArray(value) ? value : [];
}

/** A string field, or the fallback. */
export function text(value: Json, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** A number field, or the fallback. */
export function count(value: Json, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * A number the host may have sent as a STRING, or the fallback.
 *
 * GitLab reports `changes_count` as a string, and as `"1000+"` once a merge
 * request passes its own cap — so a numeric-only read silently drops the fact
 * for every MR with changes, which is every MR. The trailing `+` is dropped
 * rather than the whole value: "at least 1000" is still worth showing.
 */
export function numberish(value: Json, fallback: number): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value !== 'string') return fallback;
  const parsed = Number(value.trim().replace(/\+$/, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** A boolean field, or false. */
export function flag(value: Json): boolean {
  return value === true;
}

/** A field of a nested object, untyped — for a value that may be an ARRAY. */
export function fieldAt(value: Json, key: string): Json {
  const parent = asRecord(value);
  return parent ? parent[key] : undefined;
}

/** A nested object field, or null. */
export function recordAt(value: Json, key: string): Record<string, Json> | null {
  const parent = asRecord(value);
  return parent ? asRecord(parent[key]) : null;
}

/** A string field of a nested object, or the fallback. */
export function textAt(value: Json, key: string, fallback = ''): string {
  const parent = asRecord(value);
  return parent ? text(parent[key], fallback) : fallback;
}

/**
 * A label list from either vendor's spelling.
 *
 * GitHub sends `[{name, color}]` with the colour as six hex digits and no `#`;
 * GitLab sends plain strings. Normalizing here is what lets one row component
 * draw both, and a colour the host does not send stays null so the badge falls
 * back to the theme's own ink rather than inventing a shade.
 */
export function labelsOf(value: Json): Array<{ name: string; color: string | null }> {
  const out: Array<{ name: string; color: string | null }> = [];
  for (const entry of listAt(value)) {
    if (typeof entry === 'string') {
      if (entry.trim()) out.push({ name: entry.trim(), color: null });
      continue;
    }
    const record = asRecord(entry);
    if (!record) continue;
    const name = text(record.name).trim();
    if (!name) continue;
    const color = text(record.color).replace(/^#/, '');
    out.push({ name, color: /^[0-9a-f]{6}$/i.test(color) ? color : null });
  }
  return out;
}
