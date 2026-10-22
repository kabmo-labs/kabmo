/**
 * The `KabmoAndroid/<version>` / `KabmoIOS/<version>` token in a request's
 * User-Agent.
 *
 * Each native shell appends its own token, and it is the console's only signal
 * for two questions at once: "am I running inside a shell" and "which build of
 * it". The UA is the right channel because it crosses the very request that
 * renders the shell, so the answer needs no bridge, no extra endpoint, and no
 * round trip — the page is served already knowing.
 *
 * ONE parser for both shells, because the token grammar is one grammar and two
 * copies would be two answers to "is this a version". What differs per shell is
 * only the prefix, which is the table below.
 *
 * Parsed leniently and defensively: a browser can be made to send any UA, so a
 * forged token buys nothing here (the value only decides whether to show a
 * download button), and a malformed one must read as "not the shell" rather
 * than as version `''`.
 */

/** The native shells that report themselves on the UA. */
export type ShellKind = 'android' | 'ios';

/** The token's name, before the slash, per shell. */
export const SHELL_UA_PREFIXES: Record<ShellKind, string> = {
  android: 'KabmoAndroid/',
  ios: 'KabmoIOS/',
};

/**
 * Whether this request came from an Android device at all — the app or a
 * browser on it.
 *
 * The Android download button has two reasons to appear and they are different
 * offers: an installed APK that is behind (an UPDATE), and a reader using
 * Chrome or Brave on a phone who may not know a native shell exists (an
 * INSTALL). The second one needs this fact, which the shell token cannot
 * supply: a browser carries no `KabmoAndroid/` token, and "no token" alone
 * means "not the app" on every platform, including a desktop where an APK is
 * useless.
 *
 * Matched on `Android`, the platform token every Android browser sends, and NOT
 * on `Mobile`: an iPad sends `Mobile` and cannot install an APK, while an
 * Android tablet sends `Android` without it.
 *
 * There is deliberately no iOS counterpart. An IPA cannot be installed from a
 * browser at all — iOS has no sideload-by-URL path — so an iOS browser is
 * offered nothing, and only the installed shell asks for an update.
 */
export function isAndroidDevice(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  return /\bAndroid\b/.test(userAgent);
}

/**
 * The shell version that sent this request, or null when it is not that shell.
 *
 * The FIRST matching token wins: the suffix is appended once, and a duplicate
 * would mean something else crafted the string.
 */
export function shellVersion(
  userAgent: string | null | undefined,
  kind: ShellKind,
): string | null {
  if (!userAgent) return null;

  const prefix = SHELL_UA_PREFIXES[kind];

  for (const token of userAgent.split(/\s+/)) {
    if (!token.startsWith(prefix)) continue;
    const version = token.slice(prefix.length);
    // A version, not an arbitrary string: `1`, `1.2`, `1.2.3`, optionally with a
    // prerelease suffix. Anything else is a token this parser does not own.
    if (/^\d+(\.\d+){0,2}(-[0-9A-Za-z.-]+)?$/.test(version)) return version;
  }
  return null;
}
