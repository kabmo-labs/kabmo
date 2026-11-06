/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The settings sidebar's groups, in the order they are drawn.
 *
 * ONE list, imported by both the sidebar's type and its render loop. It used to
 * be written twice — once in the `section` union, once in the `sections` array
 * beside the drawer — so adding a group meant editing two string literals in
 * two places and a missed one silently dropped every category under it from the
 * sidebar (no error, no empty state: the loop just never asked for that group).
 *
 * `HARNESSES` is its own group rather than a member of `OMP`: omp's pages are one
 * engine's own config (engine state, providers, agents, behavior, commands,
 * MCP), while that group holds OTHER agents entirely — a different transport, a
 * different config file, and per-agent sections. Filing them together made the
 * sidebar read as "omp settings" followed by seven pages that are not omp.
 */

export const SETTINGS_SECTIONS = ['KABMO', 'WORKSPACE', 'OMP', 'HARNESSES', 'LIBRARY'] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
