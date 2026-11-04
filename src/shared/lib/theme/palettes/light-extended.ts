/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Light palettes ported verbatim from OpenChamber
 * (packages/ui/src/lib/theme/themes/*.json, MIT, upstream `main`), split out of
 * `light.ts` only because that file is at the 350-line ceiling.
 *
 * Only the values Kabmo consumes are carried: surface.background -> canvas,
 * surface.elevated -> paper, surface.foreground -> ink, status.* -> signal
 * colors, primary.base -> accent. Field order is the swatch order.
 *
 * These are the families upstream added AFTER the snapshot `light.ts` records,
 * and they are the ones this catalog was missing. Two normalizations, stated
 * because neither changes a color:
 *
 * - `osaka-jade-refined`'s upstream ids disagree across the pair (the dark file
 *   calls itself `osaka-jade-refined`); the catalog's own `${family}-${variant}`
 *   shape is used instead, and the shared name drops the per-variant suffix.
 * - `opencode`'s JSON carries `#rrggbbff` — opaque, so the alpha byte is
 *   dropped. An 8-digit value that only ever says "1.0" is noise in a palette.
 *
 * Generated data — re-port rather than hand-editing a color here.
 */

import type { ThemePalette } from '@/shared/types/theme';

export const LIGHT_EXTENDED_PALETTES = [
  {
    id: 'aurora-light',
    name: 'Aurora',
    family: 'aurora',
    variant: 'light',
    canvas: '#fdfcfa',
    paper: '#f0f3f1',
    ink: '#48423d',
    error: '#b63b32',
    success: '#507308',
    info: '#1b69ad',
    warning: '#975d04',
    meta: '#063e2a',
  },
  {
    id: 'cursor-light',
    name: 'Cursor',
    family: 'cursor',
    variant: 'light',
    canvas: '#FCFCFC',
    paper: '#f2f2f2',
    ink: '#454a50',
    error: '#A3424B',
    success: '#467037',
    info: '#315D9B',
    warning: '#806015',
    meta: '#2567A8',
  },
  {
    id: 'everforest-light',
    name: 'Everforest',
    family: 'everforest',
    variant: 'light',
    canvas: '#fdf8e8',
    paper: '#f5f2e2',
    ink: '#3b474e',
    error: '#c4222a',
    success: '#66731b',
    info: '#366eaa',
    warning: '#ad5410',
    meta: '#65740b',
  },
  {
    id: 'github-light',
    name: 'GitHub',
    family: 'github',
    variant: 'light',
    canvas: '#ffffff',
    paper: '#f5f5f4',
    ink: '#464a4e',
    error: '#8f0617',
    success: '#105122',
    info: '#09448f',
    warning: '#664407',
    meta: '#0f69d8',
  },
  {
    id: 'material-light',
    name: 'Material',
    family: 'material',
    variant: 'light',
    canvas: '#fafafa',
    paper: '#f1f1f0',
    ink: '#3e484c',
    error: '#aa0d15',
    success: '#537702',
    info: '#12787f',
    warning: '#8f6510',
    meta: '#19787f',
  },
  {
    id: 'opencode-light',
    name: 'OpenCode',
    family: 'opencode',
    variant: 'light',
    canvas: '#ffffff',
    paper: '#fafafa',
    ink: '#4a4a4a',
    error: '#b82d35',
    success: '#18833f',
    info: '#3250df',
    warning: '#8c6e24',
    meta: '#3b5cf6',
  },
  {
    id: 'osaka-jade-light',
    name: 'Osaka Jade',
    family: 'osaka-jade',
    variant: 'light',
    canvas: '#f1eee8',
    paper: '#e7e4de',
    ink: '#40463e',
    error: '#8f110b',
    success: '#02532a',
    info: '#33679f',
    warning: '#73650e',
    meta: '#197160',
  },
  {
    id: 'rose-pine-light',
    name: 'Rose Pine',
    family: 'rose-pine',
    variant: 'light',
    canvas: '#fbf5ef',
    paper: '#f5ede7',
    ink: '#464061',
    error: '#942a50',
    success: '#347846',
    info: '#0c4b62',
    warning: '#965f0b',
    meta: '#177394',
  },
  {
    id: 'vercel-light',
    name: 'Vercel',
    family: 'vercel',
    variant: 'light',
    canvas: '#ffffff',
    paper: '#f4f4f4',
    ink: '#4a4a4a',
    error: '#a10725',
    success: '#14621b',
    info: '#0a4ca2',
    warning: '#a35d02',
    meta: '#0769e1',
  },
] as const satisfies readonly ThemePalette[];
