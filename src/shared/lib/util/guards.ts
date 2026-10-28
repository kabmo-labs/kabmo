/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Dependency-free runtime guards shared by client and server. Kept free of any
 * `node:`/`bun:` import so both bundles can consume it.
 */

/** Narrows an unknown value to a plain object (never arrays or null). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
