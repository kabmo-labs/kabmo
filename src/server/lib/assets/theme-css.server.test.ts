/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The generated stylesheet as a served asset.
 *
 * The shell used to inline 182 KB of `<style>` into every `no-store` document.
 * The contract that replaced it has three parts, and each one is a way the page
 * breaks if it drifts:
 *
 * - the URL carries a content hash, so `immutable` can never serve stale bytes;
 * - the body is the palette sheet FIRST and the icon paint second, the order
 *   the inline blocks had (the icon sheet declares Tailwind's layer order);
 * - the route is reachable without a session, because the login screen is the
 *   shell and needs its own styling.
 */

import { describe, expect, test } from 'bun:test';

import { THEME_CSS_ROUTE, serveThemeCss } from '@/server/lib/assets/theme-css.server';
import { isPublicPath } from '@/server/lib/auth/guard';
import { iconPaintStyleSheet } from '@/shared/lib/icons/icon-paint-css';
import { themeStyleSheet } from '@/shared/lib/theme/css';

describe('THEME_CSS_ROUTE', () => {
  test('is content-addressed', () => {
    expect(THEME_CSS_ROUTE).toMatch(/^\/theme-[a-z0-9]+\.css$/);
  });

  test('is reachable before a credential exists', () => {
    expect(isPublicPath(THEME_CSS_ROUTE)).toBe(true);
  });
});

describe('serveThemeCss', () => {
  test('serves both sheets, palette first, as an immutable stylesheet', async () => {
    const response = await serveThemeCss(new Request(`http://localhost${THEME_CSS_ROUTE}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/css; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');

    const body = await response.text();
    expect(body).toContain(themeStyleSheet());
    expect(body).toContain(iconPaintStyleSheet());
    // The palette rules must be parsed before the icon sheet's `@layer` order.
    expect(body.indexOf('--theme-paper')).toBeLessThan(body.indexOf('@layer theme, base, components, utilities;'));
  });

  test('compresses for a client that asks', async () => {
    const response = await serveThemeCss(
      new Request(`http://localhost${THEME_CSS_ROUTE}`, { headers: { 'accept-encoding': 'gzip' } }),
    );
    expect(response.headers.get('content-encoding')).toBeTruthy();
    expect(response.headers.get('vary')).toContain('accept-encoding');
  });
});
