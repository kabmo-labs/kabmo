/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** Which side of the light/dark split a palette sits on. Drives the
 *  `data-theme-variant` attribute, Shiki's dual-theme selector and mermaid. */
export type ThemeVariant = 'light' | 'dark';

/**
 * One theme's Kabmo-facing colors.
 *
 * Deliberately a flat record of the eight values Kabmo actually paints
 * with — OpenChamber's theme files carry ~90 tokens across surfaces, syntax,
 * markdown and tools; carrying all of them would be dead weight here, since the
 * Kabmo derives everything else from these with `color-mix`.
 */
export interface ThemePalette {
  /** Stable key written to `app_settings.kabmo_settings.theme`. */
  id: string;
  /** Display name, shared by a family's light and dark entries. */
  name: string;
  /** kebab-case family key, for pairing the two variants. */
  family: string;
  variant: ThemeVariant;
  /** App ground behind panels — `--theme-canvas`. */
  canvas: string;
  /** Raised surfaces: cards, sidebars, panels — `--theme-paper`. */
  paper: string;
  /** Foreground text and borders — `--theme-ink`. */
  ink: string;
  /** Failures — `--theme-error`. */
  error: string;
  /** Success states — `--theme-success`. */
  success: string;
  /** Informational states — `--theme-info`. */
  info: string;
  /** Warnings and attention — `--theme-warning`. */
  warning: string;
  /** Accent: renames, merges, badges — `--theme-meta`. */
  meta: string;
}

/** A palette slot rendered as one chip on the appearance card. */
export interface ThemeSwatch {
  key: 'canvas' | 'paper' | 'ink' | 'error' | 'success' | 'info' | 'warning' | 'meta';
  label: string;
}
