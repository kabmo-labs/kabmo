/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The tab strip's Copy Path action.
 *
 * A tab's path may be a diff's rather than a file's, so the strip has no
 * workspace scope of its own to resolve it from; the layout owns the tabs and
 * therefore the answer. Extracted from the layout because that component is at
 * the repo's size ceiling and the action has no other dependency.
 */

import { useCallback } from 'preact/hooks';
import type { OpenedFile } from '@/shared/types/fs';

export function useCopyTabPath(): (tab: OpenedFile) => void {
  return useCallback((tab: OpenedFile) => {
    if (!tab.path) return;
    void navigator.clipboard?.writeText(tab.path);
  }, []);
}
