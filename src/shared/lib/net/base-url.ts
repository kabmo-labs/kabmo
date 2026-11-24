/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A usable HTTP(S) base URL, or null.
 *
 * The server fetches the resolved URL, so only `http:`/`https:` — and no
 * embedded credentials, which would be silently forwarded. The trailing slash
 * is removed so `{base}/audio/speech` cannot become `//audio/speech`.
 *
 * One module because dictation and speech both accept a user-supplied endpoint
 * and must refuse the same values: a second copy is how one settings page
 * accepted `file://` after the other had been fixed.
 */
export function normalizeBaseUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  return trimmed.replace(/\/+$/, '');
}
