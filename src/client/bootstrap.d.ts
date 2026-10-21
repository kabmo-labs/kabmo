export interface KabmoBootstrap {
  initialIsMobile: boolean;
  appSettings: Record<string, unknown>;
  /**
   * Whether the serving Kabmo runs in production (`NODE_ENV=production`).
   * Gates development-only chrome (the desktop ⇄ mobile layout switch).
   */
  production?: boolean;
  /**
   * Whether this request carried a valid session. `false` means the shell was
   * served to an unauthenticated visitor: `appSettings` is empty and the client
   * renders the login screen instead of the app.
   */
  authenticated?: boolean;
  /**
   * Whether the SERVING instance requires a password at all.
   *
   * Distinct from `authenticated`: that one says "this browser has a session",
   * this one says "there is a session to have". A Kabmo running open answers
   * `authenticated: true` for everyone, so it cannot be used to decide whether a
   * sign-out control makes sense — measured, the navbar drew no lock at all
   * while this fact was missing, and the only way to ask was a second request.
   */
  authEnabled?: boolean;
  /**
   * The Android shell's version, when this page was requested by the APK
   * (`KabmoAndroid/<version>` in the User-Agent). Null in every browser.
   *
   * The sidebar uses it to decide whether an UPDATE applies — this install is
   * behind the published APK.
   */
  shellVersion?: string | null;
  /**
   * Whether this request came from an Android device at all — the app, or a
   * browser running on it.
   *
   * The wider fact, and it exists for the INSTALL offer: a reader on Chrome or
   * Brave for Android carries no shell token, so `shellVersion` alone cannot
   * tell them from a desktop where an APK is useless.
   */
  isAndroid?: boolean;
}

declare global {
  interface Window {
    __OMP_BOOTSTRAP__?: KabmoBootstrap;
  }
}

export {};
