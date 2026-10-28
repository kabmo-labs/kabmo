/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Device-viewport presets for the USER browser panel's iframe. There the box
 * *is* the layout viewport, so a preset re-runs the page's media queries for
 * real. The AGENT panel does not use these: its surface is a fixed-resolution
 * screencast JPEG, which a preset could only letterbox while claiming to
 * emulate a device (emulation belongs to the agent: `tab.emulate()`).
 */

import type { ViewportMode } from '@/shared/types';

export const VIEWPORT_CLASSES: Record<ViewportMode, string> = {
  'desktop-16-9': 'w-full max-w-[1280px] aspect-video max-h-full border border-ink/20 rounded-lg shadow-md overflow-hidden my-auto',
  laptop: 'w-[1024px] max-w-full h-[768px] max-h-full border border-ink/20 rounded-lg shadow-md overflow-hidden my-auto',
  tablet: 'w-[768px] max-w-full h-[1024px] max-h-full border border-ink/20 rounded-lg shadow-md overflow-hidden my-auto',
  mobile: 'w-[375px] max-w-full h-[667px] max-h-full border border-ink/20 rounded-xl shadow-md overflow-hidden my-auto',
  'mobile-lg': 'w-[414px] max-w-full h-[896px] max-h-full border border-ink/20 rounded-xl shadow-md overflow-hidden my-auto',
  responsive: 'w-full h-full border-0',
};
