/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One mark per outline kind, shared by every surface that draws an outline.
 *
 * The kind is the only thing a row says about itself besides its name and line,
 * so it has to be readable at a glance: a class and a function are different
 * things to a reader scanning a 900-line file, and a list where every row wears
 * the same bullet is a list of names with no shape. The table is the single
 * source of that vocabulary — the desktop section and the phone's sheet both
 * render through this component, so a kind cannot be a `Boxes` in one place and
 * a `Package` in the other.
 *
 * The marks are all one tone (`text-ink/45`, the gutter's own colour): the
 * Kabmo's palette reserves chroma for failure, and a rainbow outline would be
 * the only colour on a monochrome panel. The SHAPE carries the distinction.
 */

import {
  Blocks,
  Box,
  Boxes,
  Braces,
  Component,
  Hash,
  Heading,
  KeyRound,
  ListOrdered,
  Package,
  Paintbrush,
  Plug,
  Puzzle,
  SquareFunction,
  Tag,
  Type,
  Variable,
  type LucideIcon,
} from 'lucide-preact';
import type { OutlineKind } from '@/shared/lib/code/outline/types';

interface KindMark {
  Icon: LucideIcon;
  /** What the mark means, for a tooltip and for a screen reader. */
  label: string;
}

/**
 * The kind table.
 *
 * `Record<OutlineKind, …>` rather than a partial map: adding a kind to the union
 * without a mark is a type error here, which is the only place it can be caught
 * before a row renders with no icon at all.
 */
export const OUTLINE_KIND_MARKS: Record<OutlineKind, KindMark> = {
  class: { Icon: Boxes, label: 'Class' },
  interface: { Icon: Puzzle, label: 'Interface' },
  type: { Icon: Type, label: 'Type' },
  enum: { Icon: ListOrdered, label: 'Enum' },
  function: { Icon: SquareFunction, label: 'Function' },
  method: { Icon: Component, label: 'Method' },
  constant: { Icon: Hash, label: 'Constant' },
  variable: { Icon: Variable, label: 'Variable' },
  struct: { Icon: Box, label: 'Struct' },
  trait: { Icon: Plug, label: 'Trait' },
  impl: { Icon: Blocks, label: 'Impl' },
  module: { Icon: Package, label: 'Module' },
  heading: { Icon: Heading, label: 'Heading' },
  selector: { Icon: Paintbrush, label: 'Selector' },
  key: { Icon: KeyRound, label: 'Key' },
  tag: { Icon: Tag, label: 'Tag' },
  macro: { Icon: Braces, label: 'Macro' },
};

/** A kind's mark, sized for a list row (12px) or a sheet header (14px). */
export function OutlineKindIcon({ kind, size = 12 }: { kind: OutlineKind; size?: number }) {
  const { Icon } = OUTLINE_KIND_MARKS[kind];
  return <Icon size={size} className="flex-shrink-0 text-ink/45" strokeWidth={1.8} />;
}

/** The kind's human name, for a row's `aria-label` and `title`. */
export function outlineKindLabel(kind: OutlineKind): string {
  return OUTLINE_KIND_MARKS[kind].label;
}
