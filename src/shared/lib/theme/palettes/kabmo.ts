/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Kabmo's own palettes, carried over from the hand-written
 * `[data-theme]` blocks in `tailwind.css` with their values unchanged.
 *
 * They stay in the catalog rather than becoming OpenChamber ports so an
 * existing install keeps the exact colors it was using: `paper` is the shipped
 * default and `one-dark-pro-soft` is what every dark-theme user has selected
 * until now.
 */

import type { ThemePalette } from '@/shared/types/theme';

export const KABMO_PALETTES = [
  {
    id: 'paper',
    name: 'E-Ink Paper',
    family: 'paper',
    variant: 'light',
    canvas: '#f4f1ea',
    paper: '#faf8f3',
    ink: '#141310',
    error: '#c8321e',
    success: '#047857',
    info: '#0284c7',
    warning: '#c2410c',
    meta: '#4f46e5',
  },
  {
    id: 'contrast',
    name: 'High Contrast',
    family: 'contrast',
    variant: 'light',
    canvas: '#f4f4f4',
    paper: '#ffffff',
    ink: '#111111',
    error: '#b42318',
    success: '#067647',
    info: '#0369a1',
    warning: '#b54708',
    meta: '#4338ca',
  },
  {
    id: 'one-dark-pro-soft',
    name: 'One Dark Pro Soft',
    family: 'one-dark-pro-soft',
    variant: 'dark',
    canvas: '#21252b',
    paper: '#282c34',
    ink: '#abb2bf',
    error: '#e06c75',
    success: '#34d399',
    info: '#61afef',
    warning: '#fb923c',
    meta: '#818cf8',
  },
] as const satisfies readonly ThemePalette[];
