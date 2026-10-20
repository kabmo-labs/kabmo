/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The phone header's `⋯` menu: the two controls that do not need a slot.
 *
 * Reload and sign-out are rare actions, and each costs 36px of a header that is
 * already sharing 320–412px between the wordmark, the session title and the
 * four controls that ARE used mid-conversation (context, panel, and whatever a
 * plugin contributes). Behind `⋯` they still cost 36px — but 36px ONCE, for
 * both, against 72px standing in the row.
 *
 * This is the same answer the sidebar toolbar reached when its row ran out of
 * room (`ToolbarOverflowMenu`): hiding a control outright makes it unreachable
 * at one width, and letting the row overflow hides it behind a scroll with
 * nothing on screen to say so. A menu keeps it one click away and names it in
 * words rather than as a glyph.
 *
 * ## Sign-out confirms HERE, not in the row it came from
 *
 * `SignOutButton` is a two-press control because it sits a pixel from reload.
 * A menu already costs an open and a click, so the confirmation is the first
 * row press: the row turns into `Click again to sign out` and the second press
 * ends the session. The safety property is unchanged — one stray click still
 * cannot sign the user out — and focus never leaves the menu.
 */

import { Ellipsis, Lock, LockOpen, RefreshCw } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';
import { logout, useAuthEnabled, useAuthState } from '@/client/hooks/ui/auth';

const ROW_CLASS =
  'w-full text-left px-3 py-2 flex items-center gap-2 transition-colors text-ink/75 hover:bg-ink/5 hover:text-ink cursor-pointer';

export function HeaderMoreMenu() {
  const authEnabled = useAuthEnabled();
  const authState = useAuthState();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(rootRef, () => setOpen(false));

  const canSignOut = authEnabled && authState !== 'required';
  // The open flag is mirrored into a ref so the Escape listener can be bound
  // ONCE, at mount. Binding it from an effect keyed on `open` lost the first
  // keypress after the click that opened the menu — the effect had not run yet
  // — and a menu that swallows Escape intermittently is worse than one that
  // never does, because the user cannot tell which they are looking at.
  const openRef = useRef(open);
  openRef.current = open;

  // A menu left open while the session ends elsewhere would offer an action for
  // a session that no longer exists — the same rule `SignOutButton` applies.
  useEffect(() => {
    if (!canSignOut) setConfirming(false);
  }, [canSignOut]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || !openRef.current) return;
      setOpen(false);
      setConfirming(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

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
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
          open ? 'bg-ink/10 text-ink' : 'text-ink hover:bg-ink/5 active:bg-ink/10'
        }`}
        title="More actions"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Ellipsis size={18} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 w-44 bg-paper border border-ink/15 rounded-xl shadow-lg z-50 py-1 text-xs"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              window.location.reload();
            }}
            className={ROW_CLASS}
          >
            <RefreshCw size={14} />
            <span>Reload page</span>
          </button>

          {canSignOut && (
            <button
              type="button"
              role="menuitem"
              onClick={signOut}
              disabled={busy}
              className={ROW_CLASS}
              aria-expanded={confirming}
              data-confirming={confirming ? 'true' : undefined}
            >
              {confirming ? <LockOpen size={14} /> : <Lock size={14} />}
              <span>{confirming ? 'Click again to sign out' : 'Sign out'}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
