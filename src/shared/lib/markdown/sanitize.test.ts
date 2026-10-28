/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The purifier follows the WINDOW, not the import.
 *
 * DOMPurify binds to the window that exists when it is constructed; with none
 * it reports `isSupported: false`, and `sanitize()` then returns its input
 * UNCHANGED. The module registry is shared across test files, so a file that
 * loaded `sanitize.ts` before installing a DOM used to leave every later caller
 * unsanitized — measured in CI: `viewers.test.ts` received an SVG's `<script>`
 * in the container on Windows whenever another file had imported this module
 * first. Each case here changes the window UNDER the module and re-asks.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { sanitizeHtml, sanitizeMermaidSvg } from '@/shared/lib/markdown/sanitize';

const SCRIPTED_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>window.__pwned = 1;</script><rect width="10" height="10"/></svg>';
/** A script-free SVG: happy-dom's sanitizer empties a document that holds one,
 *  so this is the input that proves the markup was parsed and re-emitted. */
const PLAIN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';

afterEach(() => restoreDomGlobals());

describe('the sanitizers bind to the live window', () => {
  test('with no document the input is returned untouched, as SSR requires', () => {
    // A bare stub: `window` exists but carries no `document`, which is exactly
    // the shape of a non-DOM runtime.
    installDomGlobals({});
    expect(sanitizeMermaidSvg(SCRIPTED_SVG)).toBe(SCRIPTED_SVG);
    expect(sanitizeHtml('<img src=x onerror="window.__pwned=1">')).toContain('onerror');
  });

  test('a window installed AFTER the import is the one that sanitizes', () => {
    installDomGlobals(new Window({ url: 'http://localhost' }));
    // Parsed and re-emitted, not passed through: happy-dom drops the root
    // `<svg>` wrapper and keeps the shape.
    expect(sanitizeMermaidSvg(PLAIN_SVG)).toContain('<rect');
    expect(sanitizeMermaidSvg(SCRIPTED_SVG)).not.toContain('<script');
    expect(sanitizeHtml('<img src=x onerror="window.__pwned=1">')).not.toContain('onerror');
  });

  test('a REPLACED window is picked up rather than the first one', () => {
    installDomGlobals(new Window({ url: 'http://first.test' }));
    expect(sanitizeMermaidSvg(PLAIN_SVG)).toContain('<rect');
    installDomGlobals(new Window({ url: 'http://second.test' }));
    expect(sanitizeMermaidSvg(PLAIN_SVG)).toContain('<rect');
    expect(sanitizeMermaidSvg(SCRIPTED_SVG)).not.toContain('<script');
  });
});
