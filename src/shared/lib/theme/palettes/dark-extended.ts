/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Dark palettes ported verbatim from OpenChamber
 * (packages/ui/src/lib/theme/themes/*.json, MIT, upstream `main`), split out of
 * `dark.ts` only because that file is at the 350-line ceiling.
 *
 * Only the values Kabmo consumes are carried: surface.background -> canvas,
 * surface.elevated -> paper, surface.foreground -> ink, status.* -> signal
 * colors, primary.base -> accent. Field order is the swatch order.
 *
 * The same two normalizations as `light-extended.ts` apply: `osaka-jade`'s ids
 * are spelled `${family}-${variant}` here (upstream's dark file names itself
 * without the variant), and `opencode`'s opaque `#rrggbbff` values drop the
 * alpha byte.
 *
 * Generated data — re-port rather than hand-editing a color here.
 */

import type { ThemePalette } from '@/shared/types/theme';

export const DARK_EXTENDED_PALETTES = [
  {
    id: 'aurora-dark',
    name: 'Aurora',
    family: 'aurora',
    variant: 'dark',
    canvas: '#131515',
    paper: '#181b1b',
    ink: '#ced2d2',
    error: '#df746d',
    success: '#6bce71',
    info: '#67abe5',
    warning: '#e2a85c',
    meta: '#239d6a',
  },
  {
    id: 'cursor-dark',
    name: 'Cursor',
    family: 'cursor',
    variant: 'dark',
    canvas: '#1a1a1a',
    paper: '#232323',
    ink: '#e1e1e2',
    error: '#c6747b',
    success: '#A3BE8C',
    info: '#81A1C1',
    warning: '#EBCB8B',
    meta: '#4c9df3',
  },
  {
    id: 'everforest-dark',
    name: 'Everforest',
    family: 'everforest',
    variant: 'dark',
    canvas: '#1c252b',
    paper: '#222c32',
    ink: '#f0efed',
    error: '#e67e80',
    success: '#a7c080',
    info: '#83afe0',
    warning: '#e69875',
    meta: '#a7c080',
  },
  {
    id: 'github-dark',
    name: 'GitHub',
    family: 'github',
    variant: 'dark',
    canvas: '#0a0e14',
    paper: '#13171e',
    ink: '#d7d8da',
    error: '#f85149',
    success: '#3fb950',
    info: '#83afe0',
    warning: '#e3b341',
    meta: '#58a6ff',
  },
  {
    id: 'material-dark',
    name: 'Material',
    family: 'material',
    variant: 'dark',
    canvas: '#1a252a',
    paper: '#212c31',
    ink: '#edeff0',
    error: '#f07178',
    success: '#c3e88d',
    info: '#83afe0',
    warning: '#ffcb6b',
    meta: '#82aaff',
  },
  {
    id: 'opencode-dark',
    name: 'OpenCode',
    family: 'opencode',
    variant: 'dark',
    canvas: '#161616',
    paper: '#1f1f1f',
    ink: '#dfdfdf',
    error: '#f17471',
    success: '#6bd586',
    info: '#7698fd',
    warning: '#f2cf76',
    meta: '#637ef8',
  },
  {
    id: 'osaka-jade-dark',
    name: 'Osaka Jade',
    family: 'osaka-jade',
    variant: 'dark',
    canvas: '#0a1611',
    paper: '#121f18',
    ink: '#d9dbd6',
    error: '#ff5345',
    success: '#63b07a',
    info: '#82aecb',
    warning: '#e7c831',
    meta: '#2dd5b7',
  },
  {
    id: 'rose-pine-dark',
    name: 'Rose Pine',
    family: 'rose-pine',
    variant: 'dark',
    canvas: '#12101d',
    paper: '#1c1a28',
    ink: '#dbdade',
    error: '#eb6f92',
    success: '#80b888',
    info: '#9ccfd8',
    warning: '#f6c177',
    meta: '#9ccfd8',
  },
  {
    id: 'vercel-dark',
    name: 'Vercel',
    family: 'vercel',
    variant: 'dark',
    canvas: '#000000',
    paper: '#070707',
    ink: '#cfcfcf',
    error: '#E5484D',
    success: '#46A758',
    info: '#52A8FF',
    warning: '#FFB224',
    meta: '#0674f3',
  },
] as const satisfies readonly ThemePalette[];
