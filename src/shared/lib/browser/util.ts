/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Small shared guards for untrusted JSON shapes: CDP payloads, DevTools
 * profiles, and the omp target registry. Every value crossing into the
 * browser viewer is `unknown` until one of these narrows it.
 */

export function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' ? value : undefined;
}

export function readNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
