/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Sign out of this browser, from either layout's header.
 *
 * ONE component for both headers, for the reason `ReloadPageButton` is one: the
 * two must agree on the accessible name, or a spec that addresses "Sign out"
 * finds it on the desktop and not on the phone. Each layout passes only its own
 * hit area, exactly as the reload control does.
 *
 * ## Why a lock, and why the label says what it does
 *
 * The icon is a lock (`Lock`, opening to `LockOpen` on hover) because that is
 * what the state IS: this instance is password-protected and this browser holds
 * the key. A door with an arrow (`LogOut`) is the usual glyph for the same
 * action, but it reads as "leave the page" in an app whose header already has a
 * reload and a layout switch — the lock says which protection is being dropped.
 *
 * The label is `Sign out`, not `Lock`: the ACTION is ending the session, and a
 * control labelled "Lock" that signs you out would be a different promise. The
 * lock is the icon; the words are the verb.
 *
 * ## When it appears
 *
 * Only when the instance requires a password AND this browser has a session —
 * `useAuthEnabled()` plus the auth store. An instance running open has nothing
 * to sign out of, and drawing the control there would advertise a protection it
 * does not have. `authEnabled` travels in the bootstrap, so the decision needs
 * no request.
 *
 * ## The confirmation
 *
 * A confirm step, not a bare click: signing out discards nothing, but it does
 * mean retyping the password, and the control sits one pixel from the reload
 * button. The second press is the same button with `aria-expanded` flipped, so a
 * keyboard user confirms without moving focus.
 */

import { useEffect, useState } from 'preact/hooks';
import { Lock, LockOpen } from 'lucide-preact';

import { logout, useAuthEnabled, useAuthState } from '@/client/hooks/ui/auth';

interface SignOutButtonProps {
  /** The surface's own hit area and colours: both layouts size controls differently. */
  className: string;
  /** Icon size in px: the desktop navbar draws 16, the phone's header 18. */
  size?: number;
}

export function SignOutButton({ className, size = 16 }: SignOutButtonProps) {
  const authEnabled = useAuthEnabled();
  const authState = useAuthState();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  // A confirmation left open while the session ends elsewhere (another tab, an
  // expiry) would offer an action for a session that no longer exists.
  useEffect(() => {
    if (!authEnabled || authState === 'required') setConfirming(false);
  }, [authEnabled, authState]);

  if (!authEnabled || authState === 'required') return null;

  const signOut = async () => {
    if (busy) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    // `logout` reloads into the login screen; a failure still leaves no usable
    // session, so there is nothing to recover here.
    await logout();
  };

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      className={className}
      title={confirming ? 'Click again to sign out' : 'Sign out'}
      aria-label={confirming ? 'Confirm sign out' : 'Sign out'}
      aria-expanded={confirming}
      data-confirming={confirming ? 'true' : undefined}
    >
      {confirming ? <LockOpen size={size} /> : <Lock size={size} />}
    </button>
  );
}
