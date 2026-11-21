/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Reading a JSON body nobody typed.
 *
 * Every field of a GitHub response is `unknown` until a guard has said
 * otherwise, and one missing field on one row must not lose the other
 * twenty-nine. Each helper answers a DEFAULT rather than throwing, and is named
 * for the shape it returns so the adapter reads as a transcription of the
 * response rather than a pile of casts.
 */

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function listAt(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function textAt(value: unknown, key: string, fallback = ''): string {
  return text(asRecord(value)?.[key], fallback);
}

export function recordAt(value: unknown, key: string): Record<string, unknown> | null {
  return asRecord(asRecord(value)?.[key]);
}

export function listOfStrings(value: unknown): string[] {
  return listAt(value).filter((entry): entry is string => typeof entry === 'string');
}
