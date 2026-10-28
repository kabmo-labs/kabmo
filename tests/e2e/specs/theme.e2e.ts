/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A theme switch reaches the runtime consumers that cannot see CSS.
 *
 * Most of the app follows the theme through CSS variables, but two things
 * cannot: the Shiki-highlighted code (its tokens arrive as `--shiki-*` custom
 * properties written per theme) and the mermaid diagrams (they are painted by a
 * JS hydrator that re-renders on a theme change). Both are driven by
 * `omp:theme-changed`, dispatched by `applyDocumentTheme` — so a theme write
 * that sets `<html data-theme>` directly leaves them on the previous palette,
 * which is the bug this spec exists to catch.
 *
 * The assertion is on the EVENT, observed on the live page, because that is the
 * contract: CSS consumers read the attribute, and every runtime consumer reads
 * the event. A unit test of `applyDocumentTheme` proves it dispatches; only this
 * proves the app's own theme control goes through it.
 */

import { test, expect } from '../fixtures/app';

/** The recorder this spec installs on the page, declared once so the reads
 *  below are checked property accesses rather than inline casts. */
declare global {
  interface Window {
    __themeEvents?: string[];
  }
}

test.describe('theme', () => {
  test('switching theme dispatches omp:theme-changed and writes both attributes', async ({ app }) => {
    // Record the events the page receives, before any click.
    await app.evaluate(() => {
      window.__themeEvents = [];
      window.addEventListener('omp:theme-changed', (event) => {
        window.__themeEvents?.push(String((event as CustomEvent).detail));
      });
    });

    await app.getByRole('button', { name: 'Settings' }).first().click();
    await app.getByRole('button', { name: 'Appearance' }).click();
    await app.getByRole('button', { name: 'Dark' }).first().click();
    await app.getByRole('button', { name: /dracula/i }).first().click();

    // The palette id and the variant are written together from the catalog.
    await expect(app.locator('html')).toHaveAttribute('data-theme', 'dracula-dark');
    await expect(app.locator('html')).toHaveAttribute('data-theme-variant', 'dark');

    const events = await app.evaluate(() => window.__themeEvents ?? []);
    expect(events).toContain('dracula-dark');
  });

  test('the palette id and variant always agree with the catalog', async ({ app }) => {
    await app.getByRole('button', { name: 'Settings' }).first().click();
    await app.getByRole('button', { name: 'Appearance' }).click();

    // Switching to a light palette must flip the variant back — a switch that
    // only rewrote the id would leave the dark variant's `color-scheme` on a
    // light palette.
    await app.getByRole('button', { name: 'Light' }).first().click();
    await app.getByRole('button', { name: /catppuccin/i }).first().click();

    await expect(app.locator('html')).toHaveAttribute('data-theme', 'catppuccin-light');
    await expect(app.locator('html')).toHaveAttribute('data-theme-variant', 'light');
  });
});
