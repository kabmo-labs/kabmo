/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Address-bar normalization shared by the browser panels. Bare hosts get an
 * `https://` scheme; anything that is not http(s) is rejected, so a typed or
 * pasted `javascript:` / `file:` / `data:` URL can never reach the browser.
 */

export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(candidate);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed');
  }
  return parsed.toString();
}
