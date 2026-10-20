/**
 * The `KabmoAndroid/<version>` token in a request's User-Agent.
 *
 * The APK appends it (`KabmoWebView.configure`), and it is the console's only
 * signal for two questions at once: "am I running inside the Android app" and
 * "which build of it". The UA is the right channel because it crosses the very
 * request that renders the shell, so the answer needs no bridge, no extra
 * endpoint, and no round trip — the page is served already knowing.
 *
 * Parsed leniently and defensively: a browser can be made to send any UA, so a
 * forged token buys nothing here (the value only decides whether to show a
 * download button), and a malformed one must read as "not the app" rather than
 * as version `''`.
 */

/** The token's name, before the slash. */
export const SHELL_UA_PREFIX = 'KabmoAndroid/';

/**
 * The APK version that sent this request, or null when it is not the app.
 *
 * The FIRST matching token wins: the suffix is appended once, and a duplicate
 * would mean something else crafted the string.
 */
export function androidShellVersion(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;

  for (const token of userAgent.split(/\s+/)) {
    if (!token.startsWith(SHELL_UA_PREFIX)) continue;
    const version = token.slice(SHELL_UA_PREFIX.length);
    // A version, not an arbitrary string: `1`, `1.2`, `1.2.3`, optionally with a
    // prerelease suffix. Anything else is a token this parser does not own.
    if (/^\d+(\.\d+){0,2}(-[0-9A-Za-z.-]+)?$/.test(version)) return version;
  }
  return null;
}
