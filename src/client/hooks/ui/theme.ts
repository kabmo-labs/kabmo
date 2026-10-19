/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The single writer for the document's theme.
 *
 * `data-theme` (the palette id) and `data-theme-variant` (light/dark) are
 * written together, and both are read from the catalog: the variant used to be
 * a hardcoded id list here, in the Shiki selector, in the mermaid hydrator and
 * in the SSR shell — four copies that a new theme would have silently missed.
 *
 * The `data-theme` attribute is the durable copy of the palette; the
 * `omp:theme-changed` event is the notification. CSS reads the attribute, and
 * the mermaid hydrator observes it, so a write that skips the event still
 * recolors — but a write that skips the attribute does not.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import { useKabmoSettingsWriter } from '@/client/hooks/settings/use-kabmo-setting';
import { applyWindowChrome } from '@/client/hooks/ui/window-chrome';
import { DEFAULT_THEME_ID, resolveTheme } from '@/shared/lib/theme/catalog';
import { THEME_STYLE_ELEMENT_ID, themeStyleSheet } from '@/shared/lib/theme/css';

/** Broadcast on every theme write. Detail is the new theme id. */
export const THEME_CHANGED_EVENT = 'omp:theme-changed';

/** The palette id currently on `<html>`, falling back to the shipped default. */
export function currentThemeId(): string {
  if (typeof document === 'undefined') return DEFAULT_THEME_ID;
  return document.documentElement.dataset.theme || document.documentElement.getAttribute('data-theme') || DEFAULT_THEME_ID;
}

/**
 * Put the catalog on the document before the first render.
 *
 * The SSR shell already inlines the stylesheet and both attributes; this is the
 * guard for a document that predates them — a cached page, or markup rendered
 * before the server restarted. Without it the page keeps `:root`'s default
 * palette and no variant attribute,
 * which is a wrong palette, not merely a stale one.
 *
 * Called once from `main.tsx` rather than from a hook: the only components that
 * read the theme are lazily mounted panels, so a hook would not run until the
 * user opened one.
 */
export function initDocumentTheme(): void {
  if (typeof document === 'undefined') return;
  if (!document.getElementById(THEME_STYLE_ELEMENT_ID)) {
    const style = document.createElement('style');
    style.id = THEME_STYLE_ELEMENT_ID;
    style.textContent = themeStyleSheet();
    document.head.appendChild(style);
  }
  applyDocumentTheme(currentThemeId());
}

/**
 * Point the document at `theme` and announce it.
 *
 * The single writer path for the theme: the settings modal and every future
 * picker call this, because a writer that only sets `data-theme` leaves runtime
 * consumers (the mermaid hydrator re-renders diagrams per palette) on the
 * previous colors until the next reload.
 */
export function applyDocumentTheme(theme: string): void {
  if (typeof document === 'undefined') return;
  const palette = resolveTheme(theme);
  const root = document.documentElement;
  root.dataset.theme = palette.id;
  root.dataset.themeVariant = palette.variant;
  // The chrome color is not simply the palette's canvas: it has to match the
  // surface at the TOP of the window, which differs per layout. See
  // `shared/lib/theme/chrome.ts` for the rule.
  applyWindowChrome(palette.id);
  window.dispatchEvent(new CustomEvent(THEME_CHANGED_EVENT, { detail: palette.id }));
}

export function useTheme() {
  const writeKabmoSettings = useKabmoSettingsWriter();
  const [theme, setThemeState] = useState<string>(currentThemeId);

  const isDark = resolveTheme(theme).variant === 'dark';

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
          setThemeState(currentThemeId());
        }
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    const handleCustomChange = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      setThemeState(detail ? resolveTheme(detail).id : currentThemeId());
    };
    window.addEventListener(THEME_CHANGED_EVENT, handleCustomChange);

    return () => {
      observer.disconnect();
      window.removeEventListener(THEME_CHANGED_EVENT, handleCustomChange);
    };
  }, []);

  const setTheme = useCallback(
    (newTheme: string) => {
      const id = resolveTheme(newTheme).id;
      applyDocumentTheme(id);
      setThemeState(id);
      writeKabmoSettings({ theme: id });
    },
    [writeKabmoSettings],
  );

  return { theme, isDark, setTheme };
}
