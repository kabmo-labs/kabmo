/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import type { DeclarationRule, MaskStyle, MemberRule } from '@/shared/lib/code/outline/rules';
import type { OutlineKind } from '@/shared/lib/code/outline/types';

export type Nesting = 'braces' | 'indent' | 'flat' | 'json' | 'markdown';

/** How one language is scanned: the rules, the mask, and how declarations nest. */
export interface ScanSpec {
  rules: readonly DeclarationRule[];
  mask: MaskStyle;
  nesting: Nesting;
  /** Kinds that open a member scope (a class body, an `impl` block). */
  scopes?: readonly OutlineKind[];
  /** Look for members one level inside a scope. */
  members?: boolean;
  /** The member rules, in the order they are tried. */
  memberRules?: readonly MemberRule[];
  /** Drop a row whose name and kind repeat the previous row (a Haskell signature). */
  dedupe?: boolean;
}
