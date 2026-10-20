/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The login screen.
 *
 * Rendered by the app shell itself rather than served as a separate HTML page,
 * so it is drawn in the user's chosen theme, in the same bundle, with no second
 * artifact to keep in step with the palette catalog. The server hands an
 * unauthenticated visitor the shell with no `appSettings`, and `App` renders
 * this instead of the workspace.
 *
 * The form posts to `/api/auth/login` and reloads on success. Reloading rather
 * than flipping a flag is deliberate: the settings the shell injects are decided
 * server-side, so only a fresh document can bring the app up with the data a
 * session entitles it to.
 */

import { useEffect, useState } from 'preact/hooks';
import type { FunctionComponent } from 'preact/compat';
import { Eye, EyeOff, Loader2 } from 'lucide-preact';
import { login, probeSession } from '@/client/hooks/ui/auth';
import { BrandWordmark } from '@/client/components/common/brand-wordmark';

export const LoginScreen: FunctionComponent = () => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [trustDevice, setTrustDevice] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // This screen is only correct while the browser has no session, and it is not
  // the only thing that can create one: a sign-in in another tab, or this
  // document restored from the back/forward cache with the state it was served
  // before. The server answers that question authoritatively, so it is asked —
  // and an answer of "signed in" leaves for the app instead of asking for a
  // password the browser already holds.
  //
  // Re-checked when the tab becomes visible rather than on a timer: the case
  // that matters is the user coming back to a tab that was left open, and a poll
  // would keep asking on behalf of a screen nobody is looking at. A `false` and
  // an unanswerable check both leave the form alone.
  useEffect(() => {
    const leaveIfSignedIn = () => {
      void probeSession().then((signedIn) => {
        if (signedIn) window.location.replace('/');
      });
    };
    leaveIfSignedIn();
    const handleVisibility = () => {
      if (!document.hidden) leaveIfSignedIn();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  const submit = async (event: Event) => {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError('');
    const result = await login(password, trustDevice);
    // A success reloads the page, so reaching here means it failed.
    setBusy(false);
    if (!result.ok) {
      setPassword('');
      setError(
        result.retryAfterSec
          ? `Too many attempts. Try again in ${Math.ceil(result.retryAfterSec / 60)} minute(s).`
          : result.error ?? 'Incorrect password',
      );
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-canvas text-ink px-4">
      <form onSubmit={submit} className="w-full max-w-xs space-y-4">
        <div className="space-y-2 text-center">
          {/* The product's own lockup is the header here: one wordmark, drawn
              at hero size, so the login screen and the app cannot disagree
              about what the product is called. No second icon — the K *is* the
              icon, and a key glyph above it said nothing the field's own label
              does not. The eye in the field is a control, not a second mark. */}
          <h1 className="flex items-center justify-center">
            <BrandWordmark className="text-3xl" />
          </h1>
          <p className="text-xs text-ink/60">This instance is password protected.</p>
        </div>

        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            autoFocus
            value={password}
            onInput={(event) => {
              setPassword(event.currentTarget.value);
              if (error) setError('');
            }}
            placeholder="Password"
            aria-label="Password"
            aria-invalid={error ? true : undefined}
            disabled={busy}
            className="w-full bg-paper border border-ink/20 rounded-lg pl-3 pr-10 py-2 text-sm text-ink placeholder-ink/40 focus:outline-none focus:border-ink/50 transition-colors"
          />
          {/* The eye is a `type` toggle, not a second field: the value lives in
              one state slot either way, so revealing it cannot change what is
              submitted. It is a real button with its own label because the
              alternative — a bare `<svg onClick>` — is unreachable by keyboard
              and unnamed for assistive tech. */}
          <button
            type="button"
            onClick={() => setShowPassword((shown) => !shown)}
            disabled={busy}
            title={showPassword ? 'Hide password' : 'Show password'}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-ink/50 hover:text-ink disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-default"
          >
            {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>

        <label className="flex items-center gap-2 text-xs text-ink/70">
          <input
            type="checkbox"
            checked={trustDevice}
            onChange={(event) => setTrustDevice(event.currentTarget.checked)}
            disabled={busy}
            className="size-3.5 accent-ink"
          />
          <span>Remember this device for 7 days</span>
        </label>

        <button
          type="submit"
          disabled={!password || busy}
          className="w-full flex items-center justify-center gap-2 bg-ink text-paper rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-40 transition-opacity cursor-pointer disabled:cursor-default"
        >
          {busy && <Loader2 size={14} className="animate-spin" />}
          <span>{busy ? 'Signing in…' : 'Sign in'}</span>
        </button>

        {error && (
          <p role="alert" className="text-xs text-error text-center">
            {error}
          </p>
        )}
      </form>
    </div>
  );
};
