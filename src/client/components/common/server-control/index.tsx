/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The server control: a trigger that says which server this window is on, and
 * the panel that changes it.
 *
 * ONE control for five shells, with two triggers because the surfaces differ and
 * the fact does not:
 *
 * - `nav` — the desktop navbar's labelled button (icon, label, status dot). The
 *   macOS / Windows / Linux windows have the room.
 * - `chip` — a phone's icon-only button. The chat header has no room left (a
 *   measured 100px free at 390 once the session title and the control cluster
 *   are paid for), so it sits in the DRAWER's title bar instead, where the row
 *   has ~158px spare and nothing has to be truncated to pay for it.
 *
 * The store lives HERE and not in the panel: the trigger and its popover must
 * read one list. Two copies is how a trigger says "running" over rows that say
 * `Stopped` — and how two 4-second polls probe every server twice.
 *
 * A desktop shell narrowed below the layout breakpoint renders the PHONE layout,
 * so its navbar is gone and only the drawer's chip is left. That is the same
 * control, not a second one, which is why it is drawn whenever an answer exists
 * rather than on a desktop-vs-phone test.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { ServerCog } from 'lucide-preact';
import { useShellServers } from '@/client/hooks/shell/servers';
import { hasShellBridge } from '@/client/lib/shell/transport';
import { ServerPanel } from '@/client/components/common/server-control/Panel';

export type ServerControlVariant = 'nav' | 'chip';

interface ServerControlProps {
  variant: ServerControlVariant;
}

/** The chip's box, matched to the drawer header's own close button. */
const CHIP_CLASS =
  'w-8 h-8 rounded-lg flex items-center justify-center text-ink/60 hover:text-ink hover:bg-ink/5 active:bg-ink/10 transition-colors cursor-pointer flex-shrink-0 titlebar-no-drag';

export function ServerControl({ variant }: ServerControlProps) {
  // A native host has to be PRESENT before the control exists at all: a browser
  // has no shell to control, and a button that opened onto "not available"
  // would be a button that never works.
  const available = hasShellBridge();
  const [open, setOpen] = useState(false);
  // The panel is PORTALLED (see `Panel.tsx` for the measured reason), so its
  // dismissal is its own backdrop — an outside-click listener rooted at the
  // trigger would read every click inside the panel as "outside".
  const triggerRef = useRef<HTMLButtonElement>(null);
  const store = useShellServers(open);
  const active =
    store.state?.entries.find((entry) => entry.id === store.state?.activeId) ??
    store.state?.detected.find((entry) => entry.url === store.state?.activeUrl) ??
    null;

  // A shell that went away (a page kept across a host restart) must not leave a
  // dangling promise behind: closing it is the honest state.
  useEffect(() => {
    if (!available) setOpen(false);
  }, [available]);

  if (!available) return null;

  const summary = active
    ? `Server: ${active.label}, ${active.running ? 'running' : 'stopped'}`
    : 'Choose a server';

  if (variant === 'chip') {
    return (
      <div className="relative flex-shrink-0">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((was) => !was)}
          className={CHIP_CLASS}
          title={summary}
          aria-label={summary}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <ServerCog size={18} strokeWidth={1.8} />
        </button>
        <ServerPanel open={open} onClose={() => setOpen(false)} variant="chip" store={store} triggerRef={triggerRef} />
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((was) => !was)}
        className="flex items-center gap-1.5 rounded px-1.5 py-1 text-ink/60 hover:text-ink hover:bg-ink/10 transition-colors cursor-pointer"
        title={summary}
        aria-label="Servers"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <ServerCog size={16} />
        {active && (
          <span className="max-w-[120px] truncate text-[11px] font-medium text-ink/70">
            {active.label}
          </span>
        )}
        <span
          className={`w-1.5 h-1.5 rounded-full ${active?.running ? 'bg-success' : 'bg-ink/25'}`}
          aria-hidden="true"
        />
      </button>
      <ServerPanel open={open} onClose={() => setOpen(false)} variant="nav" store={store} triggerRef={triggerRef} />
    </div>
  );
}
