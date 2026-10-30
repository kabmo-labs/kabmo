/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What every tool render style receives.
 *
 * Openness is owned by `useToolOpenState` in the section (it is persisted per
 * session), so a style only draws what it is given. `defaultExpanded` and the
 * internal-state fallback exist for a direct mount (a test, a plugin preview),
 * the way `ToolCardShell` has them.
 */

import type { ToolCallData } from '@/shared/types';

export interface ToolRowProps {
  tool: ToolCallData;
  isOpen?: boolean;
  onToggle?: (toolId: string) => void;
  defaultExpanded?: boolean;
}
