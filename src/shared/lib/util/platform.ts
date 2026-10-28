/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Platform sniffing for the surfaces that label a keyboard shortcut.
 *
 * The labels ("⌘F" vs "Ctrl+F") and the modifiers they match have to come from
 * one place: a shortcut that is documented as ⌘F but only bound to Ctrl+F is
 * worse than an unlabeled one. `navigator.platform` is deprecated in favour of
 * `userAgentData.platform`, but the replacement is Chromium-only — and these
 * checks only choose a modifier label, so the deprecated source is the one that
 * answers on every engine. Guarded for the server, where `navigator` does not
 * exist (shared modules are imported by both bundles).
 */

export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform);
}

/**
 * Anchored, because the unanchored form is wrong: `/Win/i` matches `Darwin`,
 * which would report every macOS machine as Windows. (Measured: the redo chord
 * then resolves to Ctrl+Y on a Mac — latent only because every call site checks
 * `isMacPlatform` first.)
 */
export function isWindowsPlatform(): boolean {
  return typeof navigator !== 'undefined' && /^Win/i.test(navigator.platform);
}
