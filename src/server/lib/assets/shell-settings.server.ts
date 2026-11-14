/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which stored settings the shell may PAINT, and which it may PUBLISH.
 *
 * The two are not the same audience. The palette, the surface material and the
 * icon tone are presentation: the login screen is the shell too, and it has to
 * paint the theme the install chose rather than the shipped default. The
 * published `appSettings` map is different — it carries the provider registry
 * and every other stored preference, which is exactly what the password
 * protects.
 *
 * Gating both on `authenticated` is what shipped, and it made a password-
 * protected install draw its login screen in the default palette while the
 * workspace behind it used the chosen one.
 */

export interface ShellSettings {
  /** Presentation facts the first frame paints, for every visitor. */
  presentation: Record<string, unknown>;
  /** The map handed to the client; empty until the request is authenticated. */
  published: Record<string, unknown>;
}

export function splitShellSettings(
  settings: Record<string, unknown>,
  authenticated: boolean,
): ShellSettings {
  return { presentation: settings, published: authenticated ? settings : {} };
}
