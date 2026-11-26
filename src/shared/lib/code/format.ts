/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { formatCompactTokens } from '@kabmo-labs/kabmo-format/number';

/**
 * Format a raw token count into a compact human label (e.g. 131072 → "128K",
 * 1048576 → "1M"). Strings are passed through unchanged (already formatted).
 *
 * Thin alias kept for the server model registry, which imports this path; the
 * single implementation lives in `@kabmo-labs/kabmo-format/number`.
 */
export function formatContextWindow(value: number | string | undefined | null): string | undefined {
  return formatCompactTokens(value);
}
