/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import type { SessionSortOption } from '@/shared/types';

/**
 * All supported workspace sort options, in menu order. Mirrors the validation
 * list in @/shared/lib/workspace/sidebar-sort so the menu can never offer an
 * option the comparator does not understand.
 */
export const SORT_OPTIONS: readonly SessionSortOption[] = ['A-Z', 'Z-A', 'LATEST_SESSION', 'LATEST_ADDED'];

/**
 * Desktop menu labels (title case). The mobile menu renders the raw option
 * with the underscore replaced, matching its compact monospace style.
 */
export const SORT_LABELS: Record<SessionSortOption, string> = {
  'A-Z': 'A-Z',
  'Z-A': 'Z-A',
  LATEST_SESSION: 'Latest Session',
  LATEST_ADDED: 'Latest Added',
};
